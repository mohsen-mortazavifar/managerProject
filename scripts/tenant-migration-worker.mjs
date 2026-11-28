// scripts/tenant-migration-worker.mjs
import sql2 from "mssql";
import { randomUUID } from "node:crypto";

// scripts/lib/tenant-migrations.mjs
import sql from "mssql";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var here = dirname(fileURLToPath(import.meta.url));
var migrationsDirectory = resolve(here, "../../database/tenant-migrations");
var baselineVersion = "V1_InitialSchema";
function splitBatches(script) {
  return script.replace(/^\uFEFF/, "").split(/^\s*GO\s*(?:--.*)?$/gim).map((batch) => batch.trim()).filter(Boolean);
}
function maskSqlCommentsAndLiterals(script) {
  const chars = [...script];
  const output = [...chars];
  let state = "normal";
  let blockDepth = 0;
  const mask = (i) => {
    if (chars[i] !== "\n" && chars[i] !== "\r") output[i] = " ";
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], n = chars[i + 1];
    if (state === "line-comment") {
      if (c === "\n" || c === "\r") state = "normal";
      else mask(i);
    } else if (state === "block-comment") {
      if (c === "/" && n === "*") {
        mask(i);
        mask(i + 1);
        blockDepth++;
        i++;
      } else if (c === "*" && n === "/") {
        mask(i);
        mask(i + 1);
        blockDepth--;
        i++;
        if (blockDepth === 0) state = "normal";
      } else mask(i);
    } else if (state === "single-quote") {
      mask(i);
      if (c === "'" && n === "'") {
        mask(i + 1);
        i++;
      } else if (c === "'") state = "normal";
    } else if (state === "double-quote") {
      mask(i);
      if (c === '"' && n === '"') {
        mask(i + 1);
        i++;
      } else if (c === '"') state = "normal";
    } else if (state === "bracket-identifier") {
      mask(i);
      if (c === "]" && n === "]") {
        mask(i + 1);
        i++;
      } else if (c === "]") state = "normal";
    } else if (c === "-" && n === "-") {
      mask(i);
      mask(i + 1);
      state = "line-comment";
      i++;
    } else if (c === "/" && n === "*") {
      mask(i);
      mask(i + 1);
      state = "block-comment";
      blockDepth = 1;
      i++;
    } else if (c === "'") {
      mask(i);
      state = "single-quote";
    } else if (c === '"') {
      mask(i);
      state = "double-quote";
    } else if (c === "[") {
      mask(i);
      state = "bracket-identifier";
    }
  }
  return output.join("");
}
async function loadTenantMigrations() {
  const files = (await readdir(migrationsDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && /^V(?:[2-9]|[1-9][0-9]+)_[A-Za-z0-9_-]+\.sql$/i.test(entry.name)).map((entry) => entry.name).sort((a, b) => {
    const av = Number(a.match(/^V([0-9]+)/i)[1]);
    const bv = Number(b.match(/^V([0-9]+)/i)[1]);
    return av - bv || a.localeCompare(b);
  });
  const migrations = [];
  let expectedNumber = 2;
  for (const file of files) {
    const number = Number(file.match(/^V([0-9]+)/i)[1]);
    if (number !== expectedNumber) {
      throw new Error(`TENANT_MIGRATION_SEQUENCE_GAP: expected V${expectedNumber}, found ${file}`);
    }
    expectedNumber++;
    const migrations = files.map((file) => {
      const version = file.replace(/\.sql$/i, "");

      if (version.length > 50) {
        throw new Error(
          `Migration version exceeds NVARCHAR(50): "${version}" ` +
          `(length: ${version.length}). Rename the migration file.`
        );
      }

      return {
        version,
        file,
      };
    });
    const content = await readFile(resolve(migrationsDirectory, file), "utf8");
    const executableSql = maskSqlCommentsAndLiterals(content);
    if (/^\s*USE\s+|\bCREATE\s+DATABASE\b|\bALTER\s+DATABASE\b|\bBEGIN\s+TRAN(?:SACTION)?\b|\bCOMMIT\s+TRAN(?:SACTION)?\b|\bROLLBACK\s+TRAN(?:SACTION)?\b/im.test(executableSql)) {
      throw new Error(`MIGRATION_CONTAINS_FORBIDDEN_TRANSACTION_OR_DATABASE_COMMAND: ${file}`);
    }
    migrations.push({
      version,
      description: `Tenant database migration ${version}`,
      checksum: createHash("sha256").update(content, "utf8").digest("hex"),
      batches: splitBatches(content)
    });
  }
  return migrations;
}
async function loadBaselineMigration() {
  const filePath = resolve(migrationsDirectory, "V1_InitialSchema.sql");
  const content = await readFile(filePath, "utf8");
  return {
    version: baselineVersion,
    content,
    checksum: createHash("sha256").update(content, "utf8").digest("hex")
  };
}
async function ensureMigrationLedger(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NULL
      THROW 52001, 'TENANT_SCHEMA_VERSION_TABLE_MISSING; initial provisioning must complete first.', 1;
    IF COL_LENGTH(N'dbo.__SchemaVersions', N'MigrationId') IS NULL
       OR COL_LENGTH(N'dbo.__SchemaVersions', N'Version') IS NULL
       OR COL_LENGTH(N'dbo.__SchemaVersions', N'Checksum') IS NULL
       OR COL_LENGTH(N'dbo.__SchemaVersions', N'AppliedAt') IS NULL
      THROW 52002, 'TENANT_SCHEMA_VERSION_TABLE_INCOMPATIBLE.', 1;
  `);
}
async function applyOneMigration(pool, databaseName, migration) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await new sql.Request(tx).input("resource", sql.NVarChar(255), `tenant-schema-migration:${databaseName}`).query(`
        DECLARE @lockResult int;
        EXEC @lockResult = sys.sp_getapplock
          @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=60000;
        IF @lockResult < 0 THROW 52003, 'TENANT_MIGRATION_LOCK_FAILED.', 1;
      `);
    const found = await new sql.Request(tx).input("version", sql.NVarChar(50), migration.version).query(`
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
    for (const batch of migration.batches) await new sql.Request(tx).batch(batch);
    await new sql.Request(tx).input("version", sql.NVarChar(50), migration.version).input("description", sql.NVarChar(500), migration.description).input("checksum", sql.NVarChar(128), migration.checksum).query(`
        INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
        VALUES (@version, @description, @checksum);
      `);
    await tx.commit();
    return "applied";
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
    }
    throw error;
  }
}

async function applyPendingMigrations(
  pool,
  databaseName,
  migrations,
  baselineChecksum
) {
  console.log(
    `[${databaseName}] migration process starting.`
  );

  // Step 1: Verify migration ledger structure.
  console.log(
    `[${databaseName}] checking migration ledger structure`
  );

  await ensureMigrationLedger(pool);

  // Step 2: Verify baseline migration.
  console.log(
    `[${databaseName}] verifying baseline: ${baselineVersion}`
  );

  const baseline = await pool.request()
    .input("version", sql.NVarChar(50), baselineVersion)
    .query(`
      SELECT TOP (1)
        Version,
        Checksum
      FROM dbo.__SchemaVersions
      WHERE Version = @version;
    `);

  const baselineRow = baseline.recordset[0];

  if (!baselineRow?.Checksum) {
    throw new Error(
      "INITIAL_SCHEMA_NOT_VERIFIED: V1_InitialSchema is missing or has no checksum."
    );
  }

  if (
    !baselineChecksum ||
    String(baselineRow.Checksum).toLowerCase() !==
    baselineChecksum.toLowerCase()
  ) {
    throw new Error(
      "MIGRATION_CHECKSUM_MISMATCH: V1_InitialSchema does not match the released baseline."
    );
  }

  console.log(
    `[${databaseName}] baseline verified successfully`
  );

  // Step 3: Read current migration ledger.
  console.log(
    `[${databaseName}] reading existing migration ledger`
  );

  const before = await pool.request().query(`
    SELECT
      MigrationId,
      Version,
      Checksum
    FROM dbo.__SchemaVersions
    ORDER BY MigrationId ASC;
  `);

  const expected = [
    baselineVersion,
    ...migrations.map(item => item.version)
  ];

  if (before.recordset.length > expected.length) {
    throw new Error(
      "TENANT_MIGRATION_LEDGER_DIVERGED: database is ahead of this release."
    );
  }

  const checksumByVersion = new Map([
    [baselineVersion, baselineChecksum],
    ...migrations.map(item => [
      item.version,
      item.checksum
    ])
  ]);

  // Step 4: Validate all previously applied migrations.
  console.log(
    `[${databaseName}] validating ${before.recordset.length} existing migration records`
  );

  for (let i = 0; i < before.recordset.length; i++) {
    const row = before.recordset[i];
    const expectedVersion = expected[i];

    if (row.Version !== expectedVersion) {
      throw new Error(
        `TENANT_MIGRATION_LEDGER_ORDER_INVALID: expected ${expectedVersion}, found ${row.Version}`
      );
    }

    const expectedChecksum = checksumByVersion.get(row.Version);

    if (!row.Checksum) {
      throw new Error(
        `MIGRATION_CHECKSUM_MISSING: ${row.Version}`
      );
    }

    if (
      !expectedChecksum ||
      String(row.Checksum).toLowerCase() !==
      expectedChecksum.toLowerCase()
    ) {
      throw new Error(
        `MIGRATION_CHECKSUM_MISMATCH: ${row.Version}`
      );
    }
  }

  console.log(
    `[${databaseName}] existing migration ledger validated`
  );

  // Step 5: Apply pending migrations.
  for (const migration of migrations) {
    console.log(
      `[${databaseName}] checking migration: ${migration.version}`
    );

    try {
      const status = await applyOneMigration(
        pool,
        databaseName,
        migration
      );

      console.log(
        `[${databaseName}] migration ${migration.version}: ${status}`
      );

      if (status === "applied") {
        console.log(
          `[${databaseName}] applied ${migration.version}`
        );
      }
    } catch (error) {
      console.error(
        `[${databaseName}] FAILED migration: ${migration.version}`,
        error?.stack ?? error
      );

      throw error;
    }
  }

  // Step 6: Verify final migration ledger.
  console.log(
    `[${databaseName}] verifying final migration ledger`
  );

  const ledger = await pool.request().query(`
    SELECT
      MigrationId,
      Version,
      Checksum
    FROM dbo.__SchemaVersions
    ORDER BY MigrationId ASC;
  `);

  if (ledger.recordset.length !== expected.length) {
    throw new Error(
      `TENANT_MIGRATION_LEDGER_DIVERGED: expected ${expected.length} records, found ${ledger.recordset.length}.`
    );
  }

  for (let i = 0; i < expected.length; i++) {
    const row = ledger.recordset[i];
    const expectedVersion = expected[i];

    if (row.Version !== expectedVersion) {
      throw new Error(
        `TENANT_MIGRATION_LEDGER_ORDER_INVALID: expected ${expectedVersion}, found ${row.Version}`
      );
    }

    if (!row.Checksum) {
      throw new Error(
        `MIGRATION_CHECKSUM_MISSING: ${row.Version}`
      );
    }

    const expectedChecksum = checksumByVersion.get(row.Version);

    if (
      !expectedChecksum ||
      String(row.Checksum).toLowerCase() !==
      expectedChecksum.toLowerCase()
    ) {
      throw new Error(
        `MIGRATION_CHECKSUM_MISMATCH: ${row.Version}`
      );
    }
  }

  const latestVersion = expected[expected.length - 1];

  console.log(
    `[${databaseName}] migration process completed successfully. Latest version: ${latestVersion}`
  );

  return latestVersion;
}


// scripts/tenant-migration-worker.mjs
var workerId = `tenant-migration-worker-${randomUUID()}`;
var pollMs = positiveInt(process.env.TENANT_MIGRATION_POLL_MS, 6e4);
var once = process.argv.includes("--once");
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
    server,
    port,
    user,
    password,
    database,
    connectionTimeout: 1e4,
    requestTimeout: 12e4,
    pool: { min: 0, max: 1, idleTimeoutMillis: 1e4 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true"
    }
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
    server,
    port,
    user,
    password,
    database: process.env.DB_NAME || "Repair_Master",
    connectionTimeout: 1e4,
    requestTimeout: 3e4,
    pool: { min: 0, max: 3, idleTimeoutMillis: 3e4 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true"
    }
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
  const allowed = (process.env.TENANT_DB_ALLOWED_SERVERS || "").split(";").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!server) throw new Error("TENANT_DATABASE_SERVER_NOT_CONFIGURED");
  if (allowed.length ? !allowed.includes(server.toLowerCase()) : server.toLowerCase() !== configuredServer) {
    throw new Error("TENANT_DATABASE_SERVER_NOT_ALLOWLISTED");
  }
  return server;
}
async function updateMasterSchemaVersion(
  masterPool,
  tenantDatabaseId,
  tenantId,
  version
) {
  const schemaVersion = String(version ?? "").trim();

  console.log("[SchemaVersion] diagnostic:", {
    value: schemaVersion,
    type: typeof version,
    length: schemaVersion.length,
    tenantDatabaseId,
    tenantId
  });

  if (!schemaVersion || schemaVersion.length > 50) {
    throw new Error(
      `INVALID_SCHEMA_VERSION: ${JSON.stringify(schemaVersion)}`
    );
  }

  // Test 1: Test parameter serialization independently.
  const testResult = await masterPool.request()
    .input("version", sql2.NVarChar(50), schemaVersion)
    .query(`
      SELECT
        @version AS ReceivedVersion,
        LEN(@version) AS VersionLength;
    `);

  console.log("[SchemaVersion] parameter test:", testResult.recordset[0]);

  // Test 2: Update master database.
  const result = await masterPool.request()
    .input("tenantDatabaseId", sql2.BigInt, tenantDatabaseId)
    .input("tenantId", sql2.BigInt, tenantId)
    .input("version", sql2.NVarChar(50), schemaVersion)
    .query(`
      UPDATE dbo.TenantDatabases
      SET
        SchemaVersion = @version,
        UpdatedAt = SYSUTCDATETIME()
      WHERE TenantDatabaseId = @tenantDatabaseId
        AND TenantId = @tenantId
        AND IsActive = 1;

      SELECT @@ROWCOUNT AS UpdatedRows;
    `);

  const updatedRows = result.recordset?.[0]?.UpdatedRows ?? 0;

  if (updatedRows !== 1) {
    throw new Error(
      `MASTER_SCHEMA_VERSION_UPDATE_FAILED: updatedRows=${updatedRows}`
    );
  }

  console.log(
    `[SchemaVersion] updated successfully: ${schemaVersion}`
  );
}
async function processTenant(masterPool, tenant, migrations) {
  const databaseName = String(tenant.DatabaseName);

  console.log(`[${databaseName}] stage 1: validating database`);

  quoteDatabaseName(databaseName);

  const serverName = assertAllowedServer(tenant.ServerName);

  console.log(`[${databaseName}] stage 2: connecting to tenant`);

  const pool = await new sql2.ConnectionPool(
    tenantConfig(databaseName, serverName)
  ).connect();

  try {
    console.log(`[${databaseName}] stage 3: loading baseline`);

    const baseline = await loadBaselineMigration();

    console.log(`[${databaseName}] stage 4: applying migrations`);

    const latest = await applyPendingMigrations(
      pool,
      databaseName,
      migrations,
      baseline.checksum
    );

    console.log(`[${databaseName}] stage 5: migrations completed`, {
      latest,
      latestType: typeof latest,
      latestLength: String(latest).length
    });

    console.log(`[${databaseName}] stage 6: updating master SchemaVersion`);

    await updateMasterSchemaVersion(
      masterPool,
      tenant.TenantDatabaseId,
      tenant.TenantId,
      latest
    );

    console.log(`[${databaseName}] stage 7: completed`);

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
      console.error(
        `[${workerId}] tenant database ${tenant.DatabaseName} failed:`,
        error?.stack ?? error
      );

      if (error?.originalError) {
        console.error("[SQL Original Error]:", error.originalError);
      }

      if (error?.precedingErrors?.length) {
        console.error("[SQL Preceding Errors]:", error.precedingErrors);
      }
    }
  }
  console.log(`[${workerId}] cycle complete: scanned=${tenants.length}, succeeded=${succeeded}, failed=${failed}, migrations=${migrations.length}`);
}
async function main() {
  const migrations = await loadTenantMigrations();
  console.log(`[${workerId}] loaded ${migrations.length} tenant migration(s).`);
  const masterPool = await new sql2.ConnectionPool(masterConfig()).connect();
  try {
    do {
      await runCycle(masterPool, migrations);
      if (once) break;
      await new Promise((resolve2) => setTimeout(resolve2, pollMs));
    } while (!once);
  } finally {
    await masterPool.close();
  }
}
main().catch((error) => {
  console.error("Tenant migration worker stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
