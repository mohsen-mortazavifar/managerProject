import sql from "mssql";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../database/tenant-migrations/V1_InitialSchema.sql");
const workerId = `${process.env.PROVISIONING_WORKER_ID || "worker"}-${randomUUID()}`;
const pollMs = positiveInt(process.env.PROVISIONING_POLL_MS, 5000);
const leaseSeconds = positiveInt(process.env.PROVISIONING_LEASE_SECONDS, 300);
const heartbeatMs = positiveInt(process.env.PROVISIONING_HEARTBEAT_MS, Math.max(1000, Math.floor(leaseSeconds * 1000 / 3)));
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

async function recoverExpiredJobs(pool) {
  const result = await pool.request().query(`
    UPDATE dbo.ProvisioningJobs
    SET Status = CASE WHEN AttemptCount >= MaxAttempts THEN 'Failed' ELSE 'RetryScheduled' END,
        RunAfter = CASE WHEN AttemptCount >= MaxAttempts THEN RunAfter
          ELSE DATEADD(minute, CASE WHEN AttemptCount < 2 THEN 1 WHEN AttemptCount < 4 THEN 5 ELSE 15 END, SYSUTCDATETIME()) END,
        WorkerId = NULL, LockedUntil = NULL,
        LastErrorCode = CASE WHEN AttemptCount >= MaxAttempts THEN 'LEASE_EXPIRED_MAX_ATTEMPTS' ELSE 'LEASE_EXPIRED_RETRY' END
    OUTPUT INSERTED.JobId, INSERTED.TenantId, INSERTED.AttemptCount, INSERTED.Status
    WHERE JobType = 'CreateTenantDatabase' AND Status = 'Running'
      AND LockedUntil <= SYSUTCDATETIME();
  `);
  for (const row of result.recordset) {
    await pool.request()
      .input("tenantId", sql.BigInt, row.TenantId)
      .input("jobId", sql.UniqueIdentifier, row.JobId)
      .input("status", sql.NVarChar(30), row.Status)
      .input("attempt", sql.Int, row.AttemptCount)
      .query(`
        INSERT INTO dbo.TenantProvisioningLogs
          (TenantId, JobId, Status, Step, Message, ErrorDetails, AttemptNumber, StartedAt, CreatedAt)
        VALUES (@tenantId, @jobId, @status, 'LeaseRecovery',
          CASE WHEN @status = 'Failed' THEN 'Worker lease expired on the final attempt; job moved to Failed.'
               ELSE 'Worker lease expired; job was scheduled for retry.' END,
          'The previous worker did not complete before its lease expired.',
          @attempt, SYSUTCDATETIME(), SYSUTCDATETIME());
      `);
  }
}

async function claimJob(pool) {
  await recoverExpiredJobs(pool);
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await new sql.Request(tx)
      .input("workerId", sql.NVarChar(200), workerId)
      .input("leaseSeconds", sql.Int, leaseSeconds)
      .query(`
        ;WITH nextJob AS (
          SELECT TOP (1) * FROM dbo.ProvisioningJobs WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE JobType = 'CreateTenantDatabase' AND RunAfter <= SYSUTCDATETIME()
            AND AttemptCount < MaxAttempts AND Status IN ('Queued', 'RetryScheduled')
          ORDER BY RunAfter, CreatedAt
        )
        UPDATE nextJob
        SET Status = 'Running', WorkerId = @workerId,
            LockedUntil = DATEADD(second, @leaseSeconds, SYSUTCDATETIME()),
            AttemptCount = AttemptCount + 1, StartedAt = COALESCE(StartedAt, SYSUTCDATETIME())
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

async function startLeaseHeartbeat(pool, job) {
  let stopped = false, leaseLost = false, inFlight = false;
  const heartbeat = async () => {
    if (stopped || leaseLost || inFlight) return;
    inFlight = true;
    try {
      const result = await pool.request()
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .input("workerId", sql.NVarChar(200), workerId)
        .input("leaseSeconds", sql.Int, leaseSeconds)
        .query(`
          UPDATE dbo.ProvisioningJobs
          SET LockedUntil = DATEADD(second, @leaseSeconds, SYSUTCDATETIME())
          WHERE JobId = @jobId AND WorkerId = @workerId AND Status = 'Running'
            AND LockedUntil > SYSUTCDATETIME();
          SELECT @@ROWCOUNT AS Affected;
        `);
      if (Number(result.recordset[0]?.Affected) !== 1) leaseLost = true;
    } catch (error) {
      console.error(`[${job.JobId}] heartbeat failed: ${error.message}`);
    } finally { inFlight = false; }
  };
  const timer = setInterval(heartbeat, heartbeatMs);
  timer.unref?.();
  return {
    async assertOwned() {
      if (leaseLost) throw new Error("PROVISIONING_LEASE_LOST");
      const result = await pool.request()
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .input("workerId", sql.NVarChar(200), workerId)
        .query(`
          SELECT 1 AS Owned FROM dbo.ProvisioningJobs
          WHERE JobId = @jobId AND WorkerId = @workerId
            AND Status = 'Running' AND LockedUntil > SYSUTCDATETIME();
        `);
      if (!result.recordset.length) { leaseLost = true; throw new Error("PROVISIONING_LEASE_LOST"); }
    },
    stop() { stopped = true; clearInterval(timer); },
  };
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
  const serverName = String(row?.ServerName ?? "127.0.0.1").trim();
  if (!serverName) throw new Error("TENANT_DATABASE_SERVER_NOT_CONFIGURED");
  const configuredServer = String(process.env.DB_SERVER ?? "").trim().toLowerCase();
  const allowedServers = (process.env.TENANT_DB_ALLOWED_SERVERS || "")
    .split(";").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowedServers.length ? !allowedServers.includes(serverName.toLowerCase()) : serverName.toLowerCase() !== configuredServer) {
    throw new Error("TENANT_DATABASE_SERVER_NOT_ALLOWLISTED");
  }
  return { databaseName: row.DatabaseName, serverName };
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

function credentialEncryptionKey() {
  const value = process.env.TENANT_CONNECTION_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("TENANT_DB_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex key.");
  }
  return Buffer.from(value, "hex");
}

function encryptCredential(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptCredential(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("INVALID_STORED_TENANT_CREDENTIAL");
  const decipher = createDecipheriv("aes-256-gcm", credentialEncryptionKey(), Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function quoteSqlIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{1,128}$/.test(value)) {
    throw new Error("INVALID_SQL_LOGIN_NAME");
  }
  return `[${value.replace(/]/g, "]]")}]`;
}

function quoteSqlLiteral(value) {
  return "N'" + String(value).replace(/'/g, "''") + "'";
}

async function provisionTenantSqlCredentials(masterPool, databaseName, job, serverName) {
  // A dedicated SQL Server login is created for each tenant database. The
  // application password is encrypted at rest in Repair_Master metadata.
  const suffix = databaseName.slice("Tenant_T_".length);
  const loginName = `tenant_${suffix.toLowerCase()}`;
  const existingCredentials = await masterPool.request()
    .input("tenantId", sql.BigInt, job.TenantId)
    .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
    .query(`
      SELECT SqlLoginName, SqlPasswordEncrypted
      FROM dbo.TenantDatabases
      WHERE TenantDatabaseId = @tenantDatabaseId AND TenantId = @tenantId;
    `);
  const existing = existingCredentials.recordset[0];
  let password;
  if (existing?.SqlLoginName === loginName && typeof existing.SqlPasswordEncrypted === "string" && existing.SqlPasswordEncrypted) {
    password = decryptCredential(existing.SqlPasswordEncrypted);
  } else {
    const passwordChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%_-";
    const passwordValues = [
      "ABCDEFGHJKLMNPQRSTUVWXYZ"[randomBytes(1)[0] % 24],
      "abcdefghijkmnopqrstuvwxyz"[randomBytes(1)[0] % 24],
      "23456789"[randomBytes(1)[0] % 8],
      "!@$%_-".split("")[randomBytes(1)[0] % 6],
      ...Array.from({ length: 44 }, () => passwordChars[randomBytes(1)[0] % passwordChars.length]),
    ];
    for (let i = passwordValues.length - 1; i > 0; i--) {
      const j = randomBytes(4).readUInt32BE(0) % (i + 1);
      [passwordValues[i], passwordValues[j]] = [passwordValues[j], passwordValues[i]];
    }
    password = passwordValues.join("");
  }
  const login = quoteSqlIdentifier(loginName);

  const master = await connect("master", serverName);
  try {
    const loginExists = await master.request()
      .input("loginName", sql.NVarChar(128), loginName)
      .query("SELECT 1 AS Found FROM sys.sql_logins WHERE name = @loginName;");
    const passwordSql = quoteSqlLiteral(password);
    if (loginExists.recordset.length) {
      await master.request().query(`ALTER LOGIN ${login} WITH PASSWORD = ${passwordSql};`);
    } else {
      await master.request().query(`CREATE LOGIN ${login} WITH PASSWORD = ${passwordSql}, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;`);
    }

    const tenant = await connect(databaseName, serverName);
    try {
      const userExists = await tenant.request()
        .input("loginName", sql.NVarChar(128), loginName)
        .query("SELECT 1 AS Found FROM sys.database_principals WHERE name = @loginName;");
      if (!userExists.recordset.length) {
        await tenant.request().query(`CREATE USER ${login} FOR LOGIN ${login};`);
      }
      await tenant.request().query(`
        IF DATABASE_PRINCIPAL_ID(N'tenant_app_runtime') IS NULL
          CREATE ROLE [tenant_app_runtime];

        IF EXISTS (
          SELECT 1 FROM sys.database_role_members rm
          JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
          JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
          WHERE rolep.name = N'db_datareader' AND memberp.name = ${quoteSqlLiteral(loginName)}
        ) ALTER ROLE [db_datareader] DROP MEMBER ${login};

        IF EXISTS (
          SELECT 1 FROM sys.database_role_members rm
          JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
          JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
          WHERE rolep.name = N'db_datawriter' AND memberp.name = ${quoteSqlLiteral(loginName)}
        ) ALTER ROLE [db_datawriter] DROP MEMBER ${login};

        IF NOT EXISTS (
          SELECT 1 FROM sys.database_role_members rm
          JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
          JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
          WHERE rolep.name = N'tenant_app_runtime' AND memberp.name = ${quoteSqlLiteral(loginName)}
        ) ALTER ROLE [tenant_app_runtime] ADD MEMBER ${login};

        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[core] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[crm] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[repair] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[inventory] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[files] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[notification] TO [tenant_app_runtime];
        GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[security] TO [tenant_app_runtime];

        GRANT EXECUTE ON SCHEMA::[core] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[crm] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[repair] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[inventory] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[files] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[notification] TO [tenant_app_runtime];
        GRANT EXECUTE ON SCHEMA::[security] TO [tenant_app_runtime];
      `);
    } finally {
      await tenant.close();
    }
  } finally {
    await master.close();
  }

  const encryptedPassword = encryptCredential(password);
  await masterPool.request()
    .input("tenantId", sql.BigInt, job.TenantId)
    .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
    .input("loginName", sql.NVarChar(128), loginName)
    .input("encryptedPassword", sql.NVarChar(1024), encryptedPassword)
    .query(`
      UPDATE dbo.TenantDatabases
      SET SqlLoginName = @loginName,
          SqlPasswordEncrypted = @encryptedPassword,
          UpdatedAt = SYSUTCDATETIME()
      WHERE TenantDatabaseId = @tenantDatabaseId AND TenantId = @tenantId;
      IF @@ROWCOUNT <> 1 THROW 51002, 'Tenant SQL credentials metadata update failed.', 1;
    `);
}

async function applyInitialMigration(name, serverName, script, migrationChecksum) {
  const tenantPool = await connect(name, serverName, process.env.DB_USER, process.env.DB_PASSWORD, process.env.TENANT_DB_PORT || process.env.DB_PORT);
  const tx = new sql.Transaction(tenantPool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input("resource", sql.NVarChar(255), `tenant-schema-migration:${name}`)
      .query(`
        DECLARE @lockResult int;
        EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
          @LockOwner='Transaction', @LockTimeout=60000;
        IF @lockResult < 0 THROW 51020, 'TENANT_MIGRATION_LOCK_FAILED', 1;
      `);
    const existing = await new sql.Request(tx)
      .input("version", sql.NVarChar(50), "V1_InitialSchema")
      .query(`
        IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NOT NULL
          SELECT TOP (1) Version, Checksum FROM dbo.__SchemaVersions WITH (UPDLOCK, HOLDLOCK) WHERE Version=@version;
        ELSE SELECT CAST(NULL AS nvarchar(50)) AS Version, CAST(NULL AS nvarchar(128)) AS Checksum;
      `);
    const applied = existing.recordset[0];
    if (applied?.Version) {
      if (applied.Checksum && String(applied.Checksum).toLowerCase() !== migrationChecksum.toLowerCase())
        throw new Error("MIGRATION_CHECKSUM_MISMATCH: V1_InitialSchema was applied with different contents.");
      if (!applied.Checksum) {
        // The previous worker could register V1 before later batches completed.
        // A NULL checksum is therefore ambiguous and must be reviewed, not adopted.
        throw new Error("MIGRATION_CHECKSUM_MISSING: V1_InitialSchema requires manual schema verification before provisioning can continue.");
      }
      await tx.commit();
      return;
    }
    const batches = splitBatches(script);
    const versionRegistrationBatches = batches.filter((batch) =>
      /INSERT\\s+INTO\\s+dbo\\.__SchemaVersions/i.test(batch) &&
      /V1_InitialSchema/i.test(batch)
    );
    if (versionRegistrationBatches.length !== 1) {
      throw new Error("INITIAL_MIGRATION_VERSION_MARKER_NOT_FOUND_OR_AMBIGUOUS");
    }
    // V1 is an immutable, historical migration. Its embedded legacy marker is
    // deliberately skipped so the worker can record the version only after
    // every schema batch has succeeded in this transaction.
    for (const batch of batches) {
      if (versionRegistrationBatches.includes(batch)) continue;
      await new sql.Request(tx).batch(batch);
    }
    await new sql.Request(tx)
      .input("version", sql.NVarChar(50), "V1_InitialSchema")
      .input("checksum", sql.NVarChar(128), migrationChecksum)
      .query(`
        IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NULL THROW 51000, 'Schema version table was not created.', 1;
        IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=@version)
          THROW 51021, 'Migration script must not register its own version.', 1;
        INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
        VALUES (@version, N'Initial tenant schema', @checksum);
      `);
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  } finally { await tenantPool.close(); }
}
async function processJob(pool, job) {
  const lease = await startLeaseHeartbeat(pool, job);
  let completed = false;
  try {
    await lease.assertOwned();
    await writeLog(pool, job, "CreatingDatabase", "CreatingDatabase", "Creating tenant database.");
    const { databaseName, serverName } = await getDatabaseInfo(pool, job);
    await ensureDatabase(databaseName, serverName);
    await lease.assertOwned();
    await writeLog(pool, job, "Migrating", "Migrating", "Applying tenant database schema.");
    await applyInitialMigration(databaseName, serverName, migration, checksum);
    await lease.assertOwned();
    await provisionTenantSqlCredentials(pool, databaseName, job, serverName);
    await lease.assertOwned();

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("tenantId", sql.BigInt, job.TenantId)
        .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .input("workerId", sql.NVarChar(200), workerId)
        .input("schemaVersion", sql.NVarChar(50), "V1_InitialSchema")
        .query(`
          UPDATE dbo.TenantDatabases SET IsActive=1, SchemaVersion=@schemaVersion, UpdatedAt=SYSUTCDATETIME()
          WHERE TenantDatabaseId=@tenantDatabaseId AND TenantId=@tenantId;
          IF @@ROWCOUNT <> 1 THROW 51001, 'Tenant database metadata update failed.', 1;
          UPDATE dbo.Tenants SET Status=N'Active', UpdatedAt=SYSUTCDATETIME()
          WHERE TenantId=@tenantId AND Status=N'Pending';
          UPDATE dbo.ProvisioningJobs
          SET Status='Succeeded', WorkerId=NULL, LockedUntil=NULL,
              CompletedAt=SYSUTCDATETIME(), LastErrorCode=NULL
          WHERE JobId=@jobId AND WorkerId=@workerId AND Status='Running'
            AND LockedUntil > SYSUTCDATETIME();
          IF @@ROWCOUNT <> 1 THROW 51022, 'PROVISIONING_LEASE_LOST_BEFORE_COMPLETION', 1;
        `);
      await tx.commit();
      completed = true;
    } catch (error) { try { await tx.rollback(); } catch {} throw error; }

    try { await writeLog(pool, job, "Completed", "Completed", "Tenant database is ready."); }
    catch (logError) { console.error(`[${job.JobId}] completion log failed: ${logError.message}`); }
    console.log(`[${job.JobId}] completed.`);
  } catch (error) {
    if (completed || error?.message === "PROVISIONING_LEASE_LOST" ||
        error?.message?.includes("PROVISIONING_LEASE_LOST_BEFORE_COMPLETION")) {
      console.error(`[${job.JobId}] lease lost; this worker will not change the job state.`);
      return;
    }
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const failed = Number(job.AttemptCount) >= Number(job.MaxAttempts);
    const result = await pool.request()
      .input("jobId", sql.UniqueIdentifier, job.JobId)
      .input("workerId", sql.NVarChar(200), workerId)
      .input("failed", sql.Bit, failed)
      .input("errorCode", sql.VarChar(80), "PROVISION_FAILED")
      .query(`
        UPDATE dbo.ProvisioningJobs
        SET Status=CASE WHEN @failed=1 THEN 'Failed' ELSE 'RetryScheduled' END,
            RunAfter=DATEADD(minute, CASE WHEN AttemptCount<2 THEN 1 WHEN AttemptCount<4 THEN 5 ELSE 15 END, SYSUTCDATETIME()),
            WorkerId=NULL, LockedUntil=NULL, LastErrorCode=@errorCode
        WHERE JobId=@jobId AND WorkerId=@workerId AND Status='Running'
          AND LockedUntil > SYSUTCDATETIME();
        SELECT @@ROWCOUNT AS Affected;
      `);
    if (Number(result.recordset[0]?.Affected) === 1) {
      try {
        await writeLog(pool, job, failed ? "Failed" : "Retrying", failed ? "Failed" : "Retrying",
          failed ? "Tenant database provisioning failed permanently." : "Tenant database provisioning failed; retry scheduled.", message);
      } catch (logError) { console.error(`[${job.JobId}] failure log failed: ${logError.message}`); }
      if (failed) await pool.request().input("tenantId", sql.BigInt, job.TenantId)
        .query("UPDATE dbo.Tenants SET Status=N'Pending', UpdatedAt=SYSUTCDATETIME() WHERE TenantId=@tenantId AND Status=N'Pending';");
    } else console.error(`[${job.JobId}] failure not recorded: this worker no longer owns the lease.`);
    console.error(`[${job.JobId}] ${failed ? "failed" : "retrying"}: ${message}`);
  } finally { lease.stop(); }
}
const migration = await readFile(migrationPath, "utf8");
const checksum = createHash("sha256").update(migration, "utf8").digest("hex");

async function main() {
  const pool = await connect(process.env.DB_NAME || "Repair_Master");
  try {
    do {
      const job = await claimJob(pool);
      if (!job) {
        if (once) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      await processJob(pool, job);
    } while (!once);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("Provisioning worker stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
