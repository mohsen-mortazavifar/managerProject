import { getSqlPool, sql } from "@/lib/db";

/**
 * Applies due subscription lifecycle transitions for the user's active tenant
 * memberships, then checks whether at least one tenant has a current active
 * subscription. Used both before issuing a platform access token and by the
 * request guard, so login and API authorization follow the same rule.
 */
export async function hasActiveSubscriptionForUser(userId: string | number): Promise<boolean> {
  const pool = await getSqlPool();

  await pool.request()
    .input("userId", sql.BigInt, userId)
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
    .input("userId", sql.BigInt, userId)
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

  return entitlement.recordset.length > 0;
}
