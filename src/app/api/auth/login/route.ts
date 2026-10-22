import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  persistSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

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
    return NextResponse.json({ error: "ایمیل یا رمز عبور نامعتبر است." }, { status: 400 });
  }

  try {
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
      return NextResponse.json(
        { error: "ایمیل یا رمز عبور صحیح نیست." },
        { status: 401 },
      );
    }

    const token = createSessionToken();
    await persistSession(token, user.UserId as string | number, request);

    await pool.request()
      .input("userId", sql.BigInt, user.UserId)
      .query("UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;");

    const response = NextResponse.json({
      user: {
        userId: String(user.UserId),
        email: String(user.Email),
        fullName: String(user.FullName),
        isSystemAdmin: Boolean(user.IsSystemAdmin),
      },
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    // Do not disclose SQL errors, schema names, or configuration to clients.
    return NextResponse.json(
      { error: "ورود موقتاً در دسترس نیست. تنظیمات سرور را بررسی کنید." },
      { status: 503 },
    );
  }
}
