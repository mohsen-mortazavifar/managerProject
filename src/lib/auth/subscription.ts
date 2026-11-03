import { getSqlPool, sql } from "@/lib/db";

/**
 * Checks the subscription attached to the user's single active tenant
 * membership. This function is intentionally read-only: subscription-worker
 * owns all subscription lifecycle transitions.
 *
 * A user linked to zero or multiple active tenants has no unambiguous
 * subscription context and is denied until the relationship is resolved.
 */
export async function hasActiveSubscriptionForUser(userId: string | number): Promise<boolean> {
  const pool = await getSqlPool();

  const memberships = await pool.request()
    .input("userId", sql.BigInt, userId)
    .query(`
      SELECT TOP (2) t.TenantId
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId
        AND tu.IsActive = 1
        AND t.DeletedAt IS NULL
        AND t.Status = N'Active'
      ORDER BY t.TenantId;
    `);

  // Never choose an arbitrary tenant when the account has multiple memberships.
  if (memberships.recordset.length !== 1) return false;

  const tenantId = memberships.recordset[0].TenantId;
  const entitlement = await pool.request()
    .input("tenantId", sql.BigInt, tenantId)
    .query(`
      SELECT TOP (1) s.SubscriptionId
      FROM dbo.Subscriptions s
      INNER JOIN dbo.Tenants t ON t.TenantId = s.TenantId
      WHERE s.TenantId = @tenantId
        AND t.DeletedAt IS NULL
        AND t.Status = N'Active'
        AND s.Status = N'Active'
        AND s.StartsAt <= SYSUTCDATETIME()
        AND s.EndsAt > SYSUTCDATETIME()
      ORDER BY s.EndsAt DESC, s.SubscriptionId DESC;
    `);

  return entitlement.recordset.length === 1;
}
