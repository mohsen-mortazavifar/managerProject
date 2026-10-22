import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";
import {
  checkLoginRateLimit,
  getLoginClientIp,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }

  const { email, password } = body as { email?: unknown; password?: unknown };
  if (
    typeof email !== "string" || typeof password !== "string" ||
    email.length > 255 || password.length < 1 || password.length > 1024
  ) {
    return NextResponse.json({ error: "ایمیل یا رمز عبور نامعتبر است." }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return NextResponse.json(
      { error: "ایمیل یا رمز عبور نامعتبر است." },
      { status: 400 }
    );
  }
  const clientIp = getLoginClientIp(request);

  try {
    const limit = await checkLoginRateLimit(normalizedEmail, clientIp);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(limit.retryAfterSeconds),
          },
        },
      );
    }

    const pool = await getSqlPool();
    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .query(`
        SELECT TOP (1) UserId, Email, PasswordHash, FullName, IsActive, IsSystemAdmin
        FROM dbo.Users
        WHERE LOWER(Email) = @email AND DeletedAt IS NULL;
      `);

    const user = result.recordset[0];
    const passwordIsValid = user
      ? await verifyPassword(password, String(user.PasswordHash || ""))
      : false;

    if (!user || !passwordIsValid || !Boolean(user.IsActive)) {
      await recordLoginAttempt(normalizedEmail, clientIp, false, request);
      return NextResponse.json(
        { error: "ایمیل یا رمز عبور صحیح نیست." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const publicUser = {
      userId: String(user.UserId),
      email: String(user.Email),
      fullName: String(user.FullName),
      isSystemAdmin: Boolean(user.IsSystemAdmin),
    };

    const accessToken = createAccessToken(publicUser);

    await pool.request()
      .input("userId", sql.BigInt, user.UserId)
      .query("UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;");

    await recordLoginAttempt(normalizedEmail, clientIp, true, request);

    const response = NextResponse.json({
      tokenType: "Bearer",
      accessToken,
      expiresIn: JWT_TTL_SECONDS,
      user: publicUser,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  } catch {
    return NextResponse.json(
      { error: "ورود موقتاً در دسترس نیست. تنظیمات سرور و اجرای اسکریپت محدودسازی ورود را بررسی کنید." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
