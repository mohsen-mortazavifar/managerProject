import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { getBearerToken, getBearerUser, hashAccessToken, type JwtUser } from "@/lib/auth/jwt";

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
    // Re-check the account on every protected request so disabled/deleted users
    // do not retain access until the JWT expires.
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
    // Authentication and account/workspace setup must remain available before
    // the first subscription is purchased or after it expires.
    const subscriptionExemptPaths = new Set([
      "/api/auth/me",
      "/api/auth/logout",
      "/api/available-plans",
      "/api/subscription-orders",
      "/api/tenants/current-status",
    ]);

    // System administrators manage the platform independently of customer plans.
    // Tenant users can access account, onboarding status, plan catalogue and orders
    // without an active subscription. Business APIs remain subscription-gated.
    if (!isPlatformUser && !subscriptionExemptPaths.has(pathname) && !pathname.startsWith("/api/admin/")) {
      // Apply subscription lifecycle transitions on demand before checking access:
      // expire ended subscriptions and activate a reserved subscription whose
      // scheduled start time has arrived. The transaction and row locks prevent
      // concurrent requests from activating the same tenant's reservation twice.
      await pool.request()
        .input("userId", sql.BigInt, user.UserId)
        .query(`
          SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();
          DECLARE @TenantIds TABLE (TenantId BIGINT PRIMARY KEY);

          INSERT INTO @TenantIds (TenantId)
          SELECT DISTINCT tu.TenantId
          FROM dbo.TenantUsers tu
          INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
          WHERE tu.UserId = @userId
            AND tu.IsActive = 1
            AND t.DeletedAt IS NULL
            AND t.Status = N'Active';

          UPDATE s WITH (UPDLOCK, HOLDLOCK)
          SET Status = N'Expired', UpdatedAt = @Now
          FROM dbo.Subscriptions s
          INNER JOIN @TenantIds tenants ON tenants.TenantId = s.TenantId
          WHERE s.Status = N'Active'
            AND s.EndsAt <= @Now;

          -- A reservation whose entire scheduled term elapsed before the next
          -- request is marked expired rather than granting an already-ended term.
          UPDATE s WITH (UPDLOCK, HOLDLOCK)
          SET Status = N'Expired', UpdatedAt = @Now
          FROM dbo.Subscriptions s
          INNER JOIN @TenantIds tenants ON tenants.TenantId = s.TenantId
          WHERE s.Status = N'Reserved'
            AND s.EndsAt <= @Now;

          ;WITH ReadyReservations AS (
            SELECT s.SubscriptionId,
              ROW_NUMBER() OVER (PARTITION BY s.TenantId ORDER BY s.StartsAt, s.SubscriptionId) AS rn
            FROM dbo.Subscriptions s WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN @TenantIds tenants ON tenants.TenantId = s.TenantId
            WHERE s.Status = N'Reserved'
              AND s.StartsAt <= @Now
              AND s.EndsAt > @Now
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.Subscriptions activeSub WITH (UPDLOCK, HOLDLOCK)
                WHERE activeSub.TenantId = s.TenantId
                  AND activeSub.Status = N'Active'
                  AND activeSub.StartsAt <= @Now
                  AND activeSub.EndsAt > @Now
              )
          )
          UPDATE s
          SET Status = N'Active', UpdatedAt = @Now
          FROM dbo.Subscriptions s
          INNER JOIN ReadyReservations ready ON ready.SubscriptionId = s.SubscriptionId
          WHERE ready.rn = 1;

          COMMIT TRANSACTION;
        `);

      const entitlement = await pool.request()
        .input("userId", sql.BigInt, user.UserId)
        .query(`
          SELECT TOP (1) t.TenantId
          FROM dbo.TenantUsers tu
          INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
          INNER JOIN dbo.Subscriptions s ON s.TenantId = t.TenantId
          WHERE tu.UserId = @userId
            AND tu.IsActive = 1
            AND t.DeletedAt IS NULL
            AND t.Status = N'Active'
            AND s.Status = N'Active'
            AND s.StartsAt <= SYSUTCDATETIME()
            AND s.EndsAt > SYSUTCDATETIME()
          ORDER BY s.EndsAt DESC;
        `);

      if (entitlement.recordset.length === 0) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "اشتراک فعال ندارید یا اعتبار آن به پایان رسیده است. برای تمدید، به بخش پلن‌ها و اشتراک‌ها بروید.", code: "SUBSCRIPTION_REQUIRED" },
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
