import sql from "mssql";
import { randomUUID } from "node:crypto";
import { applyPendingMigrations, loadTenantMigrations } from "./lib/tenant-migrations.mjs";

const workerId = `tenant-migration-worker-${randomUUID()}`;
const pollMs = positiveInt(process.env.TENANT_MIGRATION_POLL_MS, 60000);
const once = process.argv.includes("--once");

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function quoteDatabaseName(name) {
  if (typeof name !== "string" || !/^Tenant_T_[A-F0-9]{24}$/.test(name)) {
    throw new Error("INVALID_TENANT_DATABASE_NAME");
  }
  return `[${name.replace(/]/g, "]]")}]`;
}

function tenantConfig(database, server) {
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!server || !user || !password) throw new Error("DB_SERVER, DB_USER and DB_PASSWORD must be configured.");
  const portValue = process.env.TENANT_DB_PORT || process.env.DB_PORT;
  const port = portValue ? Number(portValue) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TENANT_DB_PORT/DB_PORT is invalid.");
  return {
    server, port, user, password, database,
    connectionTimeout: 10000,
    requestTimeout: 120000,
    pool: { min: 0, max: 1, idleTimeoutMillis: 10000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

function masterConfig() {
  const server = process.env.DB_SERVER;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!server || !user || !password) throw new Error("DB_SERVER, DB_USER and DB_PASSWORD must be configured.");
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT is invalid.");
  return {
    server, port, user, password,
    database: process.env.DB_NAME || "Repair_Master",
    connectionTimeout: 10000,
    requestTimeout: 30000,
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

async function listTenantDatabases(masterPool) {
  const result = await masterPool.request().query(`
    SELECT
      d.TenantDatabaseId, d.TenantId, d.DatabaseName, d.ServerName, d.SchemaVersion
    FROM dbo.TenantDatabases d
    INNER JOIN dbo.Tenants t ON t.TenantId = d.TenantId
    WHERE d.IsActive = 1
      AND t.Status = N'Active'
      AND d.DatabaseName LIKE N'Tenant_T_%'
    ORDER BY d.TenantDatabaseId;
  `);
  return result.recordset;
}

function assertAllowedServer(serverName) {
  const server = String(serverName || process.env.DB_SERVER || "").trim();
  const configuredServer = String(process.env.DB_SERVER || "").trim().toLowerCase();
  const allowed = (process.env.TENANT_DB_ALLOWED_SERVERS || "")
    .split(";").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!server) throw new Error("TENANT_DATABASE_SERVER_NOT_CONFIGURED");
  if (allowed.length ? !allowed.includes(server.toLowerCase()) : server.toLowerCase() !== configuredServer) {
    throw new Error("TENANT_DATABASE_SERVER_NOT_ALLOWLISTED");
  }
  return server;
}

async function updateMasterSchemaVersion(masterPool, tenantDatabaseId, tenantId, version) {
  await masterPool.request()
    .input("tenantDatabaseId", sql.BigInt, tenantDatabaseId)
    .input("tenantId", sql.BigInt, tenantId)
    .input("version", sql.NVarChar(50), version)
    .query(`
      UPDATE dbo.TenantDatabases
      SET SchemaVersion=@version, UpdatedAt=SYSUTCDATETIME()
      WHERE TenantDatabaseId=@tenantDatabaseId AND TenantId=@tenantId AND IsActive=1;
    `);
}

async function processTenant(masterPool, tenant, migrations) {
  const databaseName = String(tenant.DatabaseName);
  quoteDatabaseName(databaseName);
  const serverName = assertAllowedServer(tenant.ServerName);
  const pool = await new sql.ConnectionPool(tenantConfig(databaseName, serverName)).connect();
  try {
    const latest = await applyPendingMigrations(pool, databaseName, migrations);
    await updateMasterSchemaVersion(masterPool, tenant.TenantDatabaseId, tenant.TenantId, latest);
    return { databaseName, status: "success", latest };
  } finally {
    await pool.close();
  }
}

async function runCycle(masterPool, migrations) {
  const tenants = await listTenantDatabases(masterPool);
  let succeeded = 0, failed = 0;
  for (const tenant of tenants) {
    try {
      const result = await processTenant(masterPool, tenant, migrations);
      succeeded++;
      if (migrations.length) console.log(`[${workerId}] ${result.databaseName}: schema at ${result.latest}`);
    } catch (error) {
      failed++;
      console.error(`[${workerId}] tenant database ${tenant.DatabaseName} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`[${workerId}] cycle complete: scanned=${tenants.length}, succeeded=${succeeded}, failed=${failed}, migrations=${migrations.length}`);
}

async function main() {
  const migrations = await loadTenantMigrations();
  console.log(`[${workerId}] loaded ${migrations.length} tenant migration(s).`);
  const masterPool = await new sql.ConnectionPool(masterConfig()).connect();
  try {
    do {
      await runCycle(masterPool, migrations);
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (!once);
  } finally {
    await masterPool.close();
  }
}

main().catch((error) => {
  console.error("Tenant migration worker stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
