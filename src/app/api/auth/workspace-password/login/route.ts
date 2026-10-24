import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";
import { normalizeMobile } from "@/lib/auth/otp";
import { checkLoginRateLimit, getLoginClientIp, recordLoginAttempt } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);

  const input = body as { mobile?: unknown; password?: unknown };
  if (typeof input.mobile !== "string" || typeof input.password !== "string" ||
      input.password.length < 1 || input.password.length > 1024) {
    return json({ error: "شماره موبایل یا رمز عبور نامعتبر است." }, 400);
  }

  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); }
  catch { return json({ error: "شماره موبایل معتبر نیست." }, 400); }

  const clientIp = getLoginClientIp(request);
  try {
    const limit = await checkLoginRateLimit(mobile, clientIp);
    if (!limit.allowed) {
      return json({ error: "تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید." }, 429);
    }

    const pool = await getSqlPool();
    const found = await pool.request().input("mobile", sql.NVarChar(40), mobile).query(`
      SELECT TOP (1) u.UserId, u.Mobile, u.Email, u.PasswordHash, u.FullName,
             u.IsActive, u.IsSystemAdmin, u.IsPlatformUser, u.MobileVerifiedAt
      FROM dbo.Users u
      WHERE u.Mobile = @mobile AND u.DeletedAt IS NULL;
    `);
    const user = found.recordset[0];
    const passwordIsValid = user && user.PasswordHash
      ? await verifyPassword(input.password, String(user.PasswordHash))
      : false;

    if (!user || !passwordIsValid || !Boolean(user.IsActive) ||
        !user.MobileVerifiedAt || Boolean(user.IsSystemAdmin) || Boolean(user.IsPlatformUser)) {
      await recordLoginAttempt(mobile, clientIp, false, request);
      return json({ error: "شماره موبایل یا رمز عبور صحیح نیست." }, 401);
    }

    const membership = await pool.request().input("userId", sql.BigInt, user.UserId).query(`
      SELECT TOP (1) tu.TenantUserId
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId AND tu.IsActive = 1 AND tu.IsOwner = 0
        AND t.DeletedAt IS NULL AND t.Status = N'Active';
    `);
    if (!membership.recordset[0]) {
      await recordLoginAttempt(mobile, clientIp, false, request);
      return json({ error: "این حساب عضو فعال یک کسب‌وکار نیست." }, 403);
    }

    const publicUser = {
      userId: String(user.UserId),
      email: user.Email == null ? "" : String(user.Email),
      fullName: String(user.FullName),
      isSystemAdmin: false,
      isPlatformUser: false,
    };
    const accessToken = createAccessToken(publicUser);
    await pool.request().input("userId", sql.BigInt, user.UserId)
      .query("UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;");
    await recordLoginAttempt(mobile, clientIp, true, request);

    return json({ tokenType: "Bearer", accessToken, expiresIn: JWT_TTL_SECONDS, user: publicUser });
  } catch {
    return json({ error: "ورود موقتاً در دسترس نیست. تنظیمات سرور و محدودسازی ورود را بررسی کنید." }, 503);
  }
}
