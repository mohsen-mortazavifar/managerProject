# Tenant database migrations

Both tenant provisioning and the background migration worker use the shared engine in
`scripts/lib/tenant-migrations.mjs`.

## How migrations are applied

- A new tenant database: provisioning applies the immutable `V1_InitialSchema.sql`
  baseline, then every available V2+ migration in numeric order. The tenant is
  activated only after all migrations and tenant SQL credential setup succeed.
- An existing tenant database: the migration worker verifies the V1 checksum and
  applies only migration versions that are not yet recorded.
- Both paths use the same sequence checks, SHA-256 checksums, SQL application lock,
  per-migration transaction, and version ledger validation.
- The master `TenantDatabases.SchemaVersion` is set to the last verified version.
- A checksum mismatch, missing checksum, missing version, unexpected ledger version,
  or failed SQL batch stops processing that tenant. Provisioning is retried or failed
  by its normal job policy; an existing tenant is reported as failed for that cycle.

## Adding a migration

1. Add a new file under `database/tenant-migrations/`.
2. Use the next consecutive version and a descriptive name, for example
   `V2_CustomerContactIndexes.sql`, then `V3_RepairAuditFields.sql`.
3. Never edit or rename a released migration, including V1. Add a new version for
   every later change.
4. Write SQL that preserves existing tenant data. Prefer guarded
   `IF ... IS NULL` / `IF NOT EXISTS` DDL and carefully designed data backfills.
5. Do not include `GO` inside stored procedure/function/trigger bodies. Put standalone
   `GO` lines between batches.
6. Do not include `USE`, database create/alter statements, or explicit
   `BEGIN/COMMIT/ROLLBACK TRANSACTION`. The engine owns the transaction.

The engine calculates SHA-256 from each file. It applies each migration and inserts its
version/checksum in `dbo.__SchemaVersions` in the same SQL transaction. A migration
already recorded with the same checksum is skipped. A changed or missing checksum
stops processing; do not edit a released file to work around this.

Versions must be consecutive starting at V2. A missing version stops the worker before
any tenant is changed. V1 is the immutable baseline and must have a non-NULL checksum.
The engine validates the full ledger against the versions shipped with the current
release and rejects unknown or out-of-order ledger entries.

## Running

One scan and exit:

```bash
npm run tenant-migration:worker -- --once
```

Continuous polling (default every 60 seconds):

```bash
npm run tenant-migration:worker
```

Environment variables use the existing SQL connection settings:
`DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`,
`DB_TRUST_SERVER_CERTIFICATE`, `TENANT_DB_PORT`, and `TENANT_DB_ALLOWED_SERVERS`.

Optional setting: `TENANT_MIGRATION_POLL_MS` (default `60000`).

The worker selects active tenant databases whose tenant status is Active. It checks
the configured SQL Server allow-list before connecting. Each migration is protected
by a SQL Server application lock, so two worker instances cannot apply the same
migration simultaneously. A failure for one tenant is logged and does not stop
processing other tenants.

Run the worker as a separate scheduled/background process with a SQL account that can
read the master tenant catalog and apply the required DDL in tenant databases. Do not
expose this worker as a public API or run it inside a web request.

## Operational notes

- Back up tenant databases before deploying a release containing schema changes.
- Test every migration against a restored copy of a tenant database before production.
- Deploy application code only after the required migration is available.
- Review worker output for failed tenants; it reports failures and continues the cycle.
- The worker updates `TenantDatabases.SchemaVersion` from the verified tenant ledger.
- The worker does not repair a missing/NULL V1 checksum or infer whether an old
  initial schema is complete; such databases need manual review.
- The provisioning worker applies V1 and all V2+ migrations before marking a tenant
  database active or changing the tenant status to Active.
