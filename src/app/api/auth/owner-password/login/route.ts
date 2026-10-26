import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";
import { normalizeMobile } from "@/lib/auth/otp";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "درخواست نامعتبر است." }, 400);

  const input = body as { mobile?: unknown; userName?: unknown; password?: unknown };
  if (typeof input.mobile !== "string" || typeof input.userName !== "string" || typeof input.password !== "string" ||
    input.password.length < 1 || input.password.length > 1024) {
    return respond({ error: "شماره موبایل یا رمز عبور معتبر نیست." }, 400);
  }

  const userName = input.userName.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,100}$/.test(userName)) return respond({ error: "نام کاربری معتبر نیست." }, 400);

  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); }
  catch { return respond({ error: "شماره موبایل یا رمز عبور صحیح نیست." }, 401); }

  try {
    // Rate-limit key uses a one-way digest; raw mobile/password are never logged.
    const limit = await checkLoginRateLimit(mobile, null);
    if (!limit.allowed) {
      return respond({ error: "تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید." }, 429);
    }

    const pool = await getSqlPool();
    const result = await pool.request().input("mobile", sql.NVarChar(40), mobile).input("userName", sql.NVarChar(100), userName).query(`
      SELECT TOP (1) UserId, Email, PasswordHash, FullName, IsActive, IsSystemAdmin, IsPlatformUser, MobileVerifiedAt
      FROM dbo.Users
      WHERE Mobile = @mobile AND LOWER(UserName) = @userName AND DeletedAt IS NULL;
    `);
    const row = result.recordset[0];
    const validPassword = row ? await verifyPassword(input.password, String(row.PasswordHash || "")) : false;

    if (!row || !validPassword || !Boolean(row.IsActive) || !row.MobileVerifiedAt ||
      Boolean(row.IsPlatformUser) || Boolean(row.IsSystemAdmin)) {
      await recordLoginAttempt(mobile, null, false, request);
      return respond({ error: "شماره موبایل یا رمز عبور صحیح نیست." }, 401);
    }

    const ownerMembership = await pool.request().input("userId", sql.BigInt, row.UserId).query(`
      SELECT TOP (1) 1 AS IsOwner
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId
        AND tu.IsOwner = 1
        AND tu.IsActive = 1
        AND t.DeletedAt IS NULL
        AND t.Status = N'Active';
    `);
    if (!ownerMembership.recordset.length) {
      await recordLoginAttempt(mobile, null, false, request);
      return respond({ error: "ورود با رمز پشتیبان فقط برای مالک فعال کسب‌وکار مجاز است." }, 403);
    }

    const user = {
      userId: String(row.UserId),
      email: String(row.Email || ""),
      fullName: String(row.FullName || ""),
      isSystemAdmin: false,
      isPlatformUser: false,
    };
    const accessToken = createAccessToken(user);
    await pool.request().input("userId", sql.BigInt, row.UserId)
      .query("UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;");
    await recordLoginAttempt(mobile, null, true, request);
    return respond({ tokenType: "Bearer", accessToken, expiresIn: JWT_TTL_SECONDS, user });
  } catch (error) {
    console.error("[auth/login] error:", error);

    return NextResponse.json(
      {
        error:
          "ورود موقتاً در دسترس نیست. تنظیمات سرور و اجرای اسکریپت محدودسازی ورود را بررسی کنید.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
