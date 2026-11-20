import sql from "mssql";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(here, "../../database/tenant-migrations");
const baselineVersion = "V1_InitialSchema";

export function splitBatches(script) {
  return script.replace(/^\uFEFF/, "")
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

export async function loadTenantMigrations() {
  const files = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^V(?:[2-9]|[1-9][0-9]+)_[A-Za-z0-9_-]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
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
    const version = file.replace(/\.sql$/i, "");
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

export async function loadBaselineMigration() {
  const filePath = resolve(migrationsDirectory, "V1_InitialSchema.sql");
  const content = await readFile(filePath, "utf8");
  return {
    version: baselineVersion,
    content,
    checksum: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

export async function applyInitialMigration(pool, databaseName, script, migrationChecksum) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await new sql.Request(tx)
      .input("resource", sql.NVarChar(255), `tenant-schema-migration:${databaseName}`)
      .query(`
        DECLARE @lockResult int;
        EXEC @lockResult = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
          @LockOwner='Transaction', @LockTimeout=60000;
        IF @lockResult < 0 THROW 51020, 'TENANT_MIGRATION_LOCK_FAILED', 1;
      `);
    const existing = await new sql.Request(tx)
      .input("version", sql.NVarChar(50), baselineVersion)
      .query(`
        IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NOT NULL
          SELECT TOP (1) Version, Checksum FROM dbo.__SchemaVersions WITH (UPDLOCK, HOLDLOCK) WHERE Version=@version;
        ELSE SELECT CAST(NULL AS nvarchar(50)) AS Version, CAST(NULL AS nvarchar(128)) AS Checksum;
      `);
    const applied = existing.recordset[0];
    if (applied?.Version) {
      if (!applied.Checksum) throw new Error("MIGRATION_CHECKSUM_MISSING: V1_InitialSchema requires manual schema verification.");
      if (String(applied.Checksum).toLowerCase() !== migrationChecksum.toLowerCase()) {
        throw new Error("MIGRATION_CHECKSUM_MISMATCH: V1_InitialSchema was applied with different contents.");
      }
      await tx.commit();
      return "already-applied";
    }

    const batches = splitBatches(script);
    const markerBatches = batches.filter((batch) =>
      /INSERT\s+INTO\s+dbo\.__SchemaVersions/i.test(batch) && /V1_InitialSchema/i.test(batch)
    );
    if (markerBatches.length !== 1) throw new Error("INITIAL_MIGRATION_VERSION_MARKER_NOT_FOUND_OR_AMBIGUOUS");

    // Keep the released V1 file unchanged. Skip its old marker and write a
    // checksum only after every schema batch has succeeded in this transaction.
    for (const batch of batches) {
      if (markerBatches.includes(batch)) continue;
      await new sql.Request(tx).batch(batch);
    }
    await new sql.Request(tx)
      .input("version", sql.NVarChar(50), baselineVersion)
      .input("checksum", sql.NVarChar(128), migrationChecksum)
      .query(`
        IF OBJECT_ID(N'dbo.__SchemaVersions', N'U') IS NULL THROW 51000, 'Schema version table was not created.', 1;
        IF EXISTS (SELECT 1 FROM dbo.__SchemaVersions WHERE Version=@version)
          THROW 51021, 'Migration script must not register its own version.', 1;
        INSERT INTO dbo.__SchemaVersions (Version, Description, Checksum)
        VALUES (@version, N'Initial tenant schema', @checksum);
      `);
    await tx.commit();
    return "applied";
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  }
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
    for (const batch of migration.batches) await new sql.Request(tx).batch(batch);
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

export async function applyPendingMigrations(pool, databaseName, migrations, baselineChecksum) {
  await ensureMigrationLedger(pool);
  const baseline = await pool.request()
    .input("version", sql.NVarChar(50), baselineVersion)
    .query(`
      SELECT TOP(1) Version, Checksum
      FROM dbo.__SchemaVersions
      WHERE Version=@version;
    `);
  const baselineRow = baseline.recordset[0];
  if (!baselineRow?.Checksum) {
    throw new Error("INITIAL_SCHEMA_NOT_VERIFIED: V1_InitialSchema is missing or has no checksum.");
  }
  if (!baselineChecksum || String(baselineRow.Checksum).toLowerCase() !== baselineChecksum.toLowerCase()) {
    throw new Error("MIGRATION_CHECKSUM_MISMATCH: V1_InitialSchema does not match the released baseline.");
  }

  // Validate the existing ledger as a contiguous prefix before applying anything.
  const before = await pool.request().query(`
    SELECT Version, Checksum FROM dbo.__SchemaVersions ORDER BY MigrationId ASC;
  `);
  const expected = [baselineVersion, ...migrations.map((item) => item.version)];
  if (before.recordset.length > expected.length) {
    throw new Error("TENANT_MIGRATION_LEDGER_DIVERGED: database is ahead of this release.");
  }
  const checksumByVersion = new Map([
    [baselineVersion, baselineChecksum],
    ...migrations.map((item) => [item.version, item.checksum]),
  ]);
  for (let i = 0; i < before.recordset.length; i++) {
    const row = before.recordset[i];
    if (row.Version !== expected[i]) {
      throw new Error(`TENANT_MIGRATION_LEDGER_ORDER_INVALID: expected ${expected[i]}, found ${row.Version}`);
    }
    const expectedChecksum = checksumByVersion.get(row.Version);
    if (!row.Checksum) throw new Error(`MIGRATION_CHECKSUM_MISSING: ${row.Version}`);
    if (String(row.Checksum).toLowerCase() !== expectedChecksum.toLowerCase()) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${row.Version}`);
    }
  }

  for (const migration of migrations) {
    const status = await applyOneMigration(pool, databaseName, migration);
    if (status === "applied") console.log(`[${databaseName}] applied ${migration.version}`);
  }

  const ledger = await pool.request().query(`
    SELECT Version, Checksum FROM dbo.__SchemaVersions ORDER BY MigrationId ASC;
  `);
  if (ledger.recordset.length !== expected.length) {
    throw new Error("TENANT_MIGRATION_LEDGER_DIVERGED: database contains a version not present in this release.");
  }
  for (let i = 0; i < expected.length; i++) {
    const row = ledger.recordset[i];
    if (row.Version !== expected[i]) {
      throw new Error(`TENANT_MIGRATION_LEDGER_ORDER_INVALID: expected ${expected[i]}, found ${row.Version}`);
    }
    if (!row.Checksum) throw new Error(`MIGRATION_CHECKSUM_MISSING: ${row.Version}`);
  }
  return expected[expected.length - 1];
}
