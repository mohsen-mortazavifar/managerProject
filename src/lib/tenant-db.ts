import sql, { type config as SqlConfig } from "mssql";
import { getSqlPool } from "@/lib/db";

const globalForTenantPools = globalThis as typeof globalThis & {
  tenantSqlPools?: Map<string, sql.ConnectionPool>;
  tenantSqlPoolPromises?: Map<string, Promise<sql.ConnectionPool>>;
};

export type TenantDatabaseResult =
  | { ok: true; tenantId: string; databaseName: string; pool: sql.ConnectionPool }
  | { ok: false; reason: "PLATFORM_USER" | "NO_ACTIVE_TENANT" | "TENANT_NOT_READY" | "DATABASE_NOT_CONFIGURED" };

function getTenantSqlConfig(database: string): SqlConfig {
  const server = process.env.DB_SERVER;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!server || !user || !password) throw new Error("SQL Server connection settings are incomplete.");

  const portValue = process.env.DB_PORT;
  const port = portValue ? Number(portValue) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT is invalid.");

  return {
    server, port, user, password, database,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    pool: { min: 0, max: 5, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

/**
 * Resolves the tenant database only from a user ID already verified by requireAuth.
 * Never accept a database name or tenant ID supplied by the browser.
 */
export async function getTenantSqlPoolForUser(
  userId: string,
  isPlatformUser = false,
): Promise<TenantDatabaseResult> {
  if (isPlatformUser) return { ok: false, reason: "PLATFORM_USER" };

  const master = await getSqlPool();
  const result = await master.request()
    .input("userId", sql.BigInt, userId)
    .query(`
      SELECT TOP (2)
        t.TenantId, t.Status AS TenantStatus,
        td.DatabaseName, td.IsActive AS DatabaseIsActive, td.SchemaVersion
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId AND t.DeletedAt IS NULL
      INNER JOIN dbo.TenantDatabases td ON td.TenantId = t.TenantId
      WHERE tu.UserId = @userId
        AND tu.IsActive = 1
      ORDER BY tu.IsOwner DESC, t.CreatedAt DESC, td.CreatedAt DESC;
    `);

  if (result.recordset.length !== 1) {
    return { ok: false, reason: "NO_ACTIVE_TENANT" };
  }

  const row = result.recordset[0];
  if (String(row.TenantStatus) !== "Active" || !Boolean(row.DatabaseIsActive) ||
      String(row.SchemaVersion || "") !== "V1_InitialSchema") {
    return { ok: false, reason: "TENANT_NOT_READY" };
  }

  const databaseName = String(row.DatabaseName || "");
  // Matches the database naming contract enforced by the provisioning worker.
  if (!/^Tenant_T_[A-F0-9]{24}$/.test(databaseName)) {
    return { ok: false, reason: "DATABASE_NOT_CONFIGURED" };
  }

  const pools = globalForTenantPools.tenantSqlPools ??= new Map<string, sql.ConnectionPool>();
  const pending = globalForTenantPools.tenantSqlPoolPromises ??= new Map<string, Promise<sql.ConnectionPool>>();
  if (pools.get(databaseName)?.connected) {
    return { ok: true, tenantId: String(row.TenantId), databaseName, pool: pools.get(databaseName)! };
  }

  let promise = pending.get(databaseName);
  if (!promise) {
    const pool = new sql.ConnectionPool(getTenantSqlConfig(databaseName));
    promise = pool.connect().then(
      connected => {
        pools.set(databaseName, connected);
        return connected;
      },
      error => {
        pending.delete(databaseName);
        throw error;
      },
    );
    pending.set(databaseName, promise);
  }

  const pool = await promise;
  return { ok: true, tenantId: String(row.TenantId), databaseName, pool };
}
