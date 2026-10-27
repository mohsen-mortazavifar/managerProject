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
        IF NOT EXISTS (
          SELECT 1 FROM sys.database_role_members rm
          JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
          JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
          WHERE rolep.name = N'db_datareader' AND memberp.name = ${quoteSqlLiteral(loginName)}
        ) ALTER ROLE [db_datareader] ADD MEMBER ${login};

        IF NOT EXISTS (
          SELECT 1 FROM sys.database_role_members rm
          JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
          JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
          WHERE rolep.name = N'db_datawriter' AND memberp.name = ${quoteSqlLiteral(loginName)}
        ) ALTER ROLE [db_datawriter] ADD MEMBER ${login};

        GRANT EXECUTE ON SCHEMA::[core] TO ${login};
        GRANT EXECUTE ON SCHEMA::[crm] TO ${login};
        GRANT EXECUTE ON SCHEMA::[repair] TO ${login};
        GRANT EXECUTE ON SCHEMA::[inventory] TO ${login};
        GRANT EXECUTE ON SCHEMA::[files] TO ${login};
        GRANT EXECUTE ON SCHEMA::[notification] TO ${login};
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

async function seedTenantOwner(masterPool, databaseName, serverName, job) {
  const ownerResult = await masterPool.request()
    .input("tenantId", sql.BigInt, job.TenantId)
    .query(`
      SELECT TOP (1) u.UserId, u.Email, u.Mobile, u.FullName, u.PasswordHash, u.IsActive
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Users u ON u.UserId = tu.UserId
      WHERE tu.TenantId = @tenantId AND tu.IsOwner = 1 AND tu.IsActive = 1
        AND u.DeletedAt IS NULL
      ORDER BY tu.TenantUserId;
    `);
  const owner = ownerResult.recordset[0];
  if (!owner) throw new Error("TENANT_OWNER_NOT_FOUND");

  const masterUserId = Number(owner.UserId);
  if (!Number.isSafeInteger(masterUserId) || masterUserId <= 0) {
    throw new Error("TENANT_OWNER_MASTER_USER_ID_INVALID");
  }
  const userName = String(owner.Mobile || owner.Email || `owner-${owner.UserId}`).trim();
  const displayName = String(owner.FullName || userName).trim();
  const passwordHash = String(owner.PasswordHash || "");
  if (!passwordHash) throw new Error("TENANT_OWNER_PASSWORD_HASH_MISSING");

  const tenantPool = await connect(
    databaseName, serverName,
    process.env.DB_USER, process.env.DB_PASSWORD,
    process.env.TENANT_DB_PORT || process.env.DB_PORT
  );
  try {
    await tenantPool.request()
      .input("masterUserId", sql.BigInt, owner.UserId)
      .input("userName", sql.NVarChar(100), userName.slice(0, 100))
      .input("displayName", sql.NVarChar(150), displayName.slice(0, 150))
      .input("passwordHash", sql.NVarChar(300), passwordHash.slice(0, 300))
      .input("isActive", sql.Bit, Boolean(owner.IsActive))
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE RoleId = 1)
          THROW 51010, 'BUSINESS_MANAGER_ROLE_ID_1_MISSING', 1;

        DECLARE @tenantUserId BIGINT;
        SELECT @tenantUserId = UserId
        FROM security.Users WITH (UPDLOCK, HOLDLOCK)
        WHERE MasterUserId = @masterUserId;

        IF @tenantUserId IS NULL
        BEGIN
          SELECT @tenantUserId = UserId
          FROM security.Users WITH (UPDLOCK, HOLDLOCK)
          WHERE UserName = @userName AND MasterUserId IS NULL;

          IF @tenantUserId IS NULL
          BEGIN
            INSERT INTO security.Users
              (UserName, DisplayName, PasswordHash, IsActive, CreatedAt, UpdatedAt, MasterUserId)
            VALUES
              (@userName, @displayName, @passwordHash, @isActive, SYSUTCDATETIME(), SYSUTCDATETIME(), @masterUserId);
            SET @tenantUserId = CONVERT(BIGINT, SCOPE_IDENTITY());
          END
          ELSE
          BEGIN
            UPDATE security.Users
            SET UserName = @userName, DisplayName = @displayName,
                PasswordHash = @passwordHash, IsActive = @isActive,
                UpdatedAt = SYSUTCDATETIME(), MasterUserId = @masterUserId
            WHERE UserId = @tenantUserId;
          END
        END
        ELSE
        BEGIN
          UPDATE security.Users
          SET UserName = @userName, DisplayName = @displayName,
              PasswordHash = @passwordHash, IsActive = @isActive,
              UpdatedAt = SYSUTCDATETIME()
          WHERE UserId = @tenantUserId;
        END;

        IF NOT EXISTS (
          SELECT 1 FROM security.UserRoles2
          WHERE UserId = @tenantUserId AND RoleId = 1
        )
          INSERT INTO security.UserRoles2 (UserId, RoleId, CreatedAt)
          VALUES (@tenantUserId, 1, SYSUTCDATETIME());

        COMMIT TRANSACTION;
      `);
  } catch (error) {
    try { await tenantPool.request().query("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;"); } catch {}
    throw error;
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

    await provisionTenantSqlCredentials(pool, databaseName, job, serverName);
    await seedTenantOwner(pool, databaseName, serverName, job);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("tenantId", sql.BigInt, job.TenantId)
        .input("tenantDatabaseId", sql.BigInt, job.TenantDatabaseId)
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .input("schemaVersion", sql.NVarChar(50), "V1_InitialSchema")
        .query(`
          UPDATE dbo.TenantDatabases
          SET IsActive = 1, SchemaVersion = @schemaVersion, UpdatedAt = SYSUTCDATETIME()
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
        .query("UPDATE dbo.Tenants SET Status = N'Pending', UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tenantId AND Status = N'Pending';");
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
