import sql from "mssql";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(here, "../database/tenant-migrations");
const workerId = `tenant-migration-worker-${randomUUID()}`;
const pollMs = positiveInt(process.env.TENANT_MIGRATION_POLL_MS, 60000);
const once = process.argv.includes("--once");
const maxTenants = positiveInt(process.env.TENANT_MIGRATION_MAX_TENANTS_PER_CYCLE, 1000);

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

function splitBatches(script) {
  return script.replace(/^\uFEFF/, "")
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function loadMigrations() {
  const files = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^V[2-9]\d*_[A-Za-z0-9_-]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const av = Number(a.match(/^V(\d+)/i)[1]);
      const bv = Number(b.match(/^V(\d+)/i)[1]);
      return av - bv || a.localeCompare(b);
    });

  const migrations = [];
  const seenVersions = new Set();
  for (const file of files) {
    const version = file.replace(/\.sql$/i, "");
    if (seenVersions.has(version)) throw new Error(`DUPLICATE_MIGRATION_VERSION: ${version}`);
    seenVersions.add(version);
    const content = await readFile(resolve(migrationsDirectory, file), "utf8");
    if (/^\s*USE\s+|\bCREATE\s+DATABASE\b|\bALTER\s+DATABASE\b|\bBEGIN\s+TRAN(?:SACTION)?\b|\bCOMMIT\s+TRAN(?:SACTION)?\b|\bROLLBACK\s+TRAN(?:SACTION)?\b/im.test(content)) {
      throw new Error(`MIGRATION_CONTAINS_FORBIDDEN_TRANSACTION_OR_DATABASE_COMMAND: ${file}`);
    }
    migrations.push({
      version,
      description: `Tenant database migration ${version}`,
      checksum: createHash("sha256").update(content, "utf8").digest("hex"),
      batches: splitBatches(content),
    });
  }
  return migrations;
}

async function listTenantDatabases(masterPool) {
  const result = await masterPool.request().query(`
    SELECT TOP (${maxTenants})
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

async function ensureMigrationLedger(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NULL
      THROW 52001, 'TENANT_SCHEMA_VERSION_TABLE_MISSING; initial provisioning must complete first.', 1;
    IF COL_LENGTH(N'dbo.__SchemaVersions', N'Version') IS NULL
       OR COL_LENGTH(N'dbo.__SchemaVersions', N'Checksum') IS NULL
       OR COL_LENGTH(N'dbo.__SchemaVersions', N'AppliedAt') IS NULL
      THROW 52002, 'TENANT_SCHEMA_VERSION_TABLE_INCOMPATIBLE.', 1;
  `);
}

async function applyMigration(pool, databaseName, migration) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await new sql.Request(tx)
      .input("resource", sql.NVarChar(255), `tenant-schema-migration:${databaseName}`)
      .query(`
        DECLARE @lockResult int;
        EXEC @lockResult = sys.sp_getapplock
          @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=60000;
        IF @lockResult < 0 THROW 52003, 'TENANT_MIGRATION_LOCK_FAILED.', 1;
      `);

    const found = await new sql.Request(tx)
      .input("version", sql.NVarChar(50), migration.version)
      .query(`
        SELECT TOP(1) Version, Checksum
        FROM dbo.__SchemaVersions WITH (UPDLOCK, HOLDLOCK)
        WHERE Version=@version;
      `);
    const applied = found.recordset[0];
    if (applied) {
      if (!applied.Checksum) throw new Error(`MIGRATION_CHECKSUM_MISSING: ${migration.version}`);
      if (String(applied.Checksum).toLowerCase() !== migration.checksum.toLowerCase()) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${migration.version}`);
      }
      await tx.commit();
      return "already-applied";
    }

    for (const batch of migration.batches) {
      await new sql.Request(tx).batch(batch);
    }

    await new sql.Request(tx)
      .input("version", sql.NVarChar(50), migration.version)
      .input("description", sql.NVarChar(500), migration.description)
      .input("checksum", sql.NVarChar(128), migration.checksum)
      .query(`
        INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
        VALUES (@version, @description, @checksum);
      `);
    await tx.commit();
    return "applied";
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  }
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
    await ensureMigrationLedger(pool);

    const baseline = await pool.request()
      .input("version", sql.NVarChar(50), "V1_InitialSchema")
      .query(`
        SELECT TOP(1) Version, Checksum
        FROM dbo.__SchemaVersions
        WHERE Version=@version;
      `);
    if (!baseline.recordset[0] || !baseline.recordset[0].Checksum) {
      throw new Error("INITIAL_SCHEMA_NOT_VERIFIED: V1_InitialSchema is missing or has no checksum.");
    }

    let latest = "V1_InitialSchema";
    for (const migration of migrations) {
      const status = await applyMigration(pool, databaseName, migration);
      if (status === "applied") {
        console.log(`[${workerId}] ${databaseName}: applied ${migration.version}`);
      }
      latest = migration.version;
    }

    // Keep the master catalog in sync with the tenant's actual migration ledger.
    const current = await pool.request().query(`
      SELECT TOP(1) Version FROM dbo.__SchemaVersions
      ORDER BY MigrationId DESC;
    `);
    if (current.recordset[0]?.Version) latest = String(current.recordset[0].Version);
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
  const migrations = await loadMigrations();
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
