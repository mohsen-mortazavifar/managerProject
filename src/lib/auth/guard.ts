import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { getBearerToken, getBearerUser, hashAccessToken, type JwtUser } from "@/lib/auth/jwt";

export type AuthGuardResult =
  | { ok: true; user: JwtUser }
  | { ok: false; response: NextResponse };

export async function requireAuth(request: Request): Promise<AuthGuardResult> {
  const bearerToken = getBearerToken(request);
  const tokenUser = bearerToken ? getBearerUser(request) : null;
  if (!tokenUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "توکن معتبر نیست یا منقضی شده است." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  try {
    // Re-check the account on every protected request so disabled/deleted users
    // do not retain access until the JWT expires.
    const pool = await getSqlPool();
    const tokenHash = hashAccessToken(bearerToken!);
    const revoked = await pool.request()
      .input("tokenHash", sql.VarBinary(32), tokenHash)
      .query(`
        SELECT TOP (1) TokenHash
        FROM dbo.RevokedAccessTokens
        WHERE TokenHash = @tokenHash AND ExpiresAt > SYSUTCDATETIME();
      `);

    if (revoked.recordset.length > 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "توکن باطل شده است. دوباره وارد شوید." },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }

    const result = await pool.request()
      .input("userId", sql.BigInt, tokenUser.userId)
      .query(`
        SELECT TOP (1) UserId, Email, FullName, IsSystemAdmin
        FROM dbo.Users
        WHERE UserId = @userId AND IsActive = 1 AND DeletedAt IS NULL;
      `);

    const user = result.recordset[0];
    if (!user) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "حساب کاربری غیرفعال است یا دسترسی ندارد." },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }

    return {
      ok: true,
      user: {
        userId: String(user.UserId),
        email: String(user.Email),
        fullName: String(user.FullName),
        isSystemAdmin: Boolean(user.IsSystemAdmin),
      },
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "بررسی دسترسی موقتاً در دسترس نیست." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
}

export async function requireSystemAdmin(request: Request): Promise<AuthGuardResult> {
  const result = await requireAuth(request);
  if (!result.ok) return result;

  if (!result.user.isSystemAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "برای انجام این عملیات دسترسی مدیر سیستم لازم است." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  return result;
}
