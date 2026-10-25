import sql from "mssql";
import { createHash, randomUUID } from "node:crypto";
import { encryptTenantConnectionPayload } from "./tenant-connection-crypto.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../database/tenant-migrations/V1_InitialSchema.sql");
const workerId = `${process.env.PROVISIONING_WORKER_ID || "worker"}-${randomUUID()}`;
const pollMs = positiveInt(process.env.PROVISIONING_POLL_MS, 5000);
const leaseSeconds = positiveInt(process.env.PROVISIONING_LEASE_SECONDS, 300);
const once = process.argv.includes("--once");

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function config(database, server = process.env.DB_SERVER, user = process.env.DB_USER, password = process.env.DB_PASSWORD, portValue = process.env.DB_PORT) {
  const { DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE } = process.env;
  if (!server || !user || !password) {
    throw new Error("SQL Server host, user and password must be configured.");
  }
  const port = portValue ? Number(portValue) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT is invalid.");
  return {
    server, port, user, password, database,
    connectionTimeout: 10000, requestTimeout: 120000,
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
    options: {
      encrypt: DB_ENCRYPT !== "false",
      trustServerCertificate: DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}

function splitBatches(script) {
  return script.replace(/^\uFEFF/, "")
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

function quoteDatabaseName(name) {
  if (typeof name !== "string" || !/^Tenant_T_[A-F0-9]{24}$/.test(name)) {
    throw new Error("INVALID_TENANT_DATABASE_NAME");
  }
  return `[${name.replace(/]/g, "]]")}]`;
}

async function connect(database, server = process.env.DB_SERVER, user = process.env.DB_USER, password = process.env.DB_PASSWORD, portValue = process.env.DB_PORT) {
  return new sql.ConnectionPool(config(database, server, user, password, portValue)).connect();
}

async function writeLog(pool, job, status, step, message, details = null) {
  await pool.request()
    .input("tenantId", sql.BigInt, job.TenantId)
    .input("jobId", sql.UniqueIdentifier, job.JobId)
    .input("status", sql.NVarChar(30), status)
    .input("step", sql.NVarChar(100), step)
    .input("message", sql.NVarChar(2000), message)
    .input("details", sql.NVarChar(sql.MAX), details)
    .input("attempt", sql.Int, job.AttemptCount)
    .query(`
      INSERT INTO dbo.TenantProvisioningLogs
        (TenantId, JobId, Status, Step, Message, ErrorDetails, AttemptNumber, StartedAt, CreatedAt)
      VALUES
        (@tenantId, @jobId, @status, @step, @message, @details, @attempt,
         SYSUTCDATETIME(), SYSUTCDATETIME());
    `);
}

async function claimJob(pool) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await new sql.Request(tx)
      .input("workerId", sql.NVarChar(200), workerId)
      .input("leaseSeconds", sql.Int, leaseSeconds)
      .query(`
        ;WITH nextJob AS (
          SELECT TOP (1) *
          FROM dbo.ProvisioningJobs WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE JobType = 'CreateTenantDatabase'
            AND RunAfter <= SYSUTCDATETIME()
            AND AttemptCount < MaxAttempts
            AND (
              Status IN ('Queued', 'RetryScheduled') AND RunAfter <= SYSUTCDATETIME()
              OR (Status = 'Running'  AND LockedUntil < SYSUTCDATETIME())
            )
          ORDER BY RunAfter, CreatedAt
        )
        UPDATE nextJob
        SET Status = 'Running',
            WorkerId = @workerId,
            LockedUntil = DATEADD(second, @leaseSeconds, SYSUTCDATETIME()),
            AttemptCount = AttemptCount + 1,
            StartedAt = COALESCE(StartedAt, SYSUTCDATETIME())
        OUTPUT INSERTED.JobId, INSERTED.TenantId, INSERTED.TenantDatabaseId,
               INSERTED.AttemptCount, INSERTED.MaxAttempts, INSERTED.CorrelationId;
      `);
    await tx.commit();
    return result.recordset[0] || null;
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  }
}

async function getDatabaseInfo(pool, job) {
  const result = await pool.request()
    .input("tenantId", sql.BigInt, job.TenantId)
    .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
    .query(`
      SELECT TOP (1) DatabaseName, ServerName
      FROM dbo.TenantDatabases
      WHERE TenantDatabaseId = @tenantDatabaseId AND TenantId = @tenantId;
    `);
  const row = result.recordset[0];
  quoteDatabaseName(row?.DatabaseName);
  const serverName = String(row?.ServerName ?? "").trim();
  if (!serverName) throw new Error("TENANT_DATABASE_SERVER_NOT_CONFIGURED");
  const configuredServer = String(process.env.DB_SERVER ?? "").trim().toLowerCase();
  const allowedServers = (process.env.TENANT_DB_ALLOWED_SERVERS || "")
    .split(";").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowedServers.length ? !allowedServers.includes(serverName.toLowerCase()) : serverName.toLowerCase() !== configuredServer) {
    throw new Error("TENANT_DATABASE_SERVER_NOT_ALLOWLISTED");
  }
  return { databaseName: row.DatabaseName, serverName };
}

function buildTenantConnectionPayload(databaseName, serverName) {
  const user = process.env.TENANT_DB_USER;
  const password = process.env.TENANT_DB_PASSWORD;
  const portValue = process.env.TENANT_DB_PORT || process.env.DB_PORT || "1433";
  const port = Number(portValue);
  if (!user || !password) throw new Error("TENANT_DB_USER and TENANT_DB_PASSWORD must be configured for tenant application access.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TENANT_DB_PORT is invalid.");
  return JSON.stringify({
    server: serverName,
    port,
    database: databaseName,
    user,
    password,
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  });
}

async function ensureDatabase(name, serverName) {
  const master = await connect("master", serverName, process.env.DB_USER, process.env.DB_PASSWORD, process.env.TENANT_DB_PORT || process.env.DB_PORT);
  try {
    const exists = await master.request()
      .input("databaseName", sql.NVarChar(128), name)
      .query("SELECT DB_ID(@databaseName) AS DatabaseId;");
    if (exists.recordset[0]?.DatabaseId == null) {
      await master.request().query(`CREATE DATABASE ${quoteDatabaseName(name)};`);
    }
  } finally {
    await master.close();
  }
}

async function applyInitialMigration(name, serverName, script, checksum) {
  const tenantPool = await connect(name, serverName, process.env.DB_USER, process.env.DB_PASSWORD, process.env.TENANT_DB_PORT || process.env.DB_PORT);
  try {
    const existing = await tenantPool.request().query(`
      IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NOT NULL
        SELECT TOP (1) Version FROM dbo.__SchemaVersions WHERE Version = N'V1_InitialSchema';
      ELSE SELECT CAST(NULL AS nvarchar(50)) AS Version;
    `);
    if (existing.recordset[0]?.Version === "V1_InitialSchema") return;

    for (const batch of splitBatches(script)) {
      await tenantPool.request().batch(batch);
    }

    const verify = await tenantPool.request()
      .input("version", sql.NVarChar(50), "V1_InitialSchema")
      .input("checksum", sql.NVarChar(128), checksum)
      .query(`
        IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NULL
          THROW 51000, 'Schema version table was not created.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version = @version)
          INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
          VALUES (@version, N'Initial tenant schema', @checksum);
        ELSE
          UPDATE dbo.__SchemaVersions SET Checksum = @checksum WHERE Version = @version AND Checksum IS NULL;
        SELECT TOP (1) Version FROM dbo.__SchemaVersions WHERE Version = @version;
      `);
    if (verify.recordset[0]?.Version !== "V1_InitialSchema") {
      throw new Error("INITIAL_MIGRATION_VERIFICATION_FAILED");
    }
  } finally {
    await tenantPool.close();
  }
}

async function processJob(pool, job, migration, checksum) {
  try {
    await writeLog(pool, job, "CreatingDatabase", "CreatingDatabase", "Creating tenant database.");
    const { databaseName, serverName } = await getDatabaseInfo(pool, job);
    await ensureDatabase(databaseName, serverName);

    await writeLog(pool, job, "Migrating", "Migrating", "Applying tenant database schema.");
    await applyInitialMigration(databaseName, serverName, migration, checksum);

    const encryptedConnectionString = encryptTenantConnectionPayload(buildTenantConnectionPayload(databaseName, serverName));
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("tenantId", sql.BigInt, job.TenantId)
        .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .input("schemaVersion", sql.NVarChar(50), "V1_InitialSchema")
        .input("connectionStringEncrypted", sql.NVarChar(sql.MAX), encryptedConnectionString)
        .query(`
          UPDATE dbo.TenantDatabases
          SET IsActive = 1, SchemaVersion = @schemaVersion, ConnectionStringEncrypted = @connectionStringEncrypted, UpdatedAt = SYSUTCDATETIME()
          WHERE TenantDatabaseId = @tenantDatabaseId AND TenantId = @tenantId;
          IF @@ROWCOUNT <> 1 THROW 51001, 'Tenant database metadata update failed.', 1;

          UPDATE dbo.Tenants
          SET Status = N'Active', UpdatedAt = SYSUTCDATETIME()
          WHERE TenantId = @tenantId AND Status = N'Pending';

          UPDATE dbo.ProvisioningJobs
          SET Status = 'Succeeded', WorkerId = NULL, LockedUntil = NULL,
              CompletedAt = SYSUTCDATETIME(), LastErrorCode = NULL
          WHERE JobId = @jobId;
        `);
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }

    await writeLog(pool, job, "Completed", "Completed", "Tenant database is ready.");
    console.log(`[${job.JobId}] completed.`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const failed = Number(job.AttemptCount) >= Number(job.MaxAttempts);
    await pool.request()
      .input("jobId", sql.UniqueIdentifier, job.JobId)
      .input("failed", sql.Bit, failed)
      .input("errorCode", sql.VarChar(80), "PROVISION_FAILED")
      .query(`
        UPDATE dbo.ProvisioningJobs
        SET Status = CASE WHEN @failed = 1 THEN 'Failed' ELSE 'RetryScheduled' END,
            RunAfter = DATEADD(minute, CASE WHEN AttemptCount < 2 THEN 1 WHEN AttemptCount < 4 THEN 5 ELSE 15 END, SYSUTCDATETIME()),
            WorkerId = NULL, LockedUntil = NULL, LastErrorCode = @errorCode
        WHERE JobId = @jobId;
      `);
    await writeLog(pool, job, failed ? "Failed" : "Retrying",
      failed ? "Failed" : "Retrying",
      failed ? "Tenant database provisioning failed permanently." : "Tenant database provisioning failed; retry scheduled.",
      message);
    if (failed) {
      await pool.request()
        .input("tenantId", sql.BigInt, job.TenantId)
        .query("UPDATE dbo.Tenants SET Status = N'Failed', UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tenantId AND Status = N'Pending';");
    }
    console.error(`[${job.JobId}] ${failed ? "failed" : "retrying"}: ${message}`);
  }
}

async function main() {
  const migration = await readFile(migrationPath, "utf8");
  const checksum = createHash("sha256").update(migration, "utf8").digest("hex");
  const pool = await connect(process.env.DB_NAME || "Repair_Master");
  try {
    do {
      const job = await claimJob(pool);
      if (!job) {
        if (once) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      await processJob(pool, job, migration, checksum);
    } while (!once);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("Provisioning worker stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
