import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { getBearerToken, getBearerUser, hashAccessToken, type JwtUser } from "@/lib/auth/jwt";
import { hasActiveSubscriptionForUser } from "@/lib/auth/subscription";

export type AuthGuardResult =
  | { ok: true; user: JwtUser }
  | { ok: false; response: NextResponse };

export async function requireAuth(request: Request): Promise<AuthGuardResult> {
  const bearerToken = getBearerToken(request);
  const tokenUser = bearerToken ? getBearerUser(request) : null;
  if (!bearerToken || !tokenUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "توکن معتبر نیست یا منقضی شده است." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  try {
    const pool = await getSqlPool();
    const tokenHash = hashAccessToken(bearerToken);
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
        SELECT TOP (1) UserId, Email, FullName, IsSystemAdmin, IsPlatformUser
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

    const isSystemAdmin = Boolean(user.IsSystemAdmin);
    const isPlatformUser = Boolean(user.IsPlatformUser) || isSystemAdmin;
    const pathname = new URL(request.url).pathname;

    // Owners may reach only the subscription and account-recovery flow without
    // an active plan. Require one unambiguous active owner tenant.
    const ownerSubscriptionExemptPaths = new Set([
      "/api/auth/me",
      "/api/auth/logout",
      "/api/available-plans",
      "/api/subscription-orders",
      "/api/tenants/current-status",
      "/api/auth/owner-password/set",
    ]);
    const alwaysExemptPaths = new Set(["/api/auth/logout"]);
    let mayUseOwnerSubscriptionFlow = false;

    if (!isPlatformUser && ownerSubscriptionExemptPaths.has(pathname)) {
      const ownerMembership = await pool.request()
        .input("userId", sql.BigInt, user.UserId)
        .query(`
          SELECT TOP (2) t.TenantId
          FROM dbo.TenantUsers tu
          INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
          WHERE tu.UserId = @userId
            AND tu.IsOwner = 1
            AND tu.IsActive = 1
            AND t.DeletedAt IS NULL
            AND t.Status IN (N'Active', N'Pending')
          ORDER BY t.TenantId;
        `);
      mayUseOwnerSubscriptionFlow = ownerMembership.recordset.length === 1;
    }

    if (!alwaysExemptPaths.has(pathname) && !mayUseOwnerSubscriptionFlow) {
      const hasSubscription = await hasActiveSubscriptionForUser(String(user.UserId));
      if (!hasSubscription) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: "اشتراک فعال ندارید یا اعتبار آن به پایان رسیده است. برای خرید یا تمدید اشتراک اقدام کنید.",
              code: "SUBSCRIPTION_REQUIRED",
              redirectTo: isPlatformUser ? "/" : "/workspace/subscription2",
            },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          ),
        };
      }
    }

    return {
      ok: true,
      user: {
        userId: String(user.UserId),
        email: String(user.Email),
        fullName: String(user.FullName),
        isSystemAdmin,
        isPlatformUser,
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
