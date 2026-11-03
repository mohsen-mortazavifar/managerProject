# Tenant database migrations

The `tenant-migration-worker.mjs` applies new, versioned SQL migrations to active tenant databases. It is separate from the provisioning worker: provisioning creates a tenant database and applies the immutable V1 baseline; this worker applies V2 and later changes to databases that already exist.

## Adding a migration

1. Add a new file under `database/tenant-migrations/`.
2. Use the next consecutive version and a descriptive name, for example `V2_CustomerContactIndexes.sql`, then `V3_RepairAuditFields.sql`.
3. Never edit or rename an already released migration. Add a new version for every later change.
4. Write SQL that preserves existing tenant data. Prefer guarded `IF ... IS NULL` / `IF NOT EXISTS` DDL and carefully designed data backfills.
5. Do not include `GO` inside stored procedure/function/trigger bodies. Put standalone `GO` lines between batches.
6. Do not include `USE`, database create/alter statements, or explicit `BEGIN/COMMIT/ROLLBACK TRANSACTION`. The worker owns the transaction.

The worker calculates SHA-256 from each file. It applies each migration and inserts its version/checksum in `dbo.__SchemaVersions` in the same SQL transaction. A failed batch rolls back that migration. A migration already recorded with the same checksum is skipped. A changed checksum or missing checksum stops that tenant's run; do not edit a released file to work around this.

Versions must be consecutive starting at V2. A missing version stops the worker before any tenant is changed. V1 is the immutable baseline and must already have a non-NULL checksum.

## Running

One scan and exit:

```bash
npm run tenant-migration:worker -- --once
```

Continuous polling (default every 60 seconds):

```bash
npm run tenant-migration:worker
```

Environment variables use the existing SQL connection settings: `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `TENANT_DB_PORT`, and `TENANT_DB_ALLOWED_SERVERS`.

Optional settings:
- `TENANT_MIGRATION_POLL_MS` (default `60000`)
- `TENANT_MIGRATION_MAX_TENANTS_PER_CYCLE` (default `1000`)

The worker only selects active tenant databases whose tenant status is Active and whose database name matches the platform naming rule. It checks the configured SQL Server allow-list before connecting. Each tenant migration is protected by a SQL Server application lock, so two worker instances cannot apply the same migration simultaneously. A failure for one tenant is logged and does not stop processing other tenants.

Run the worker as a separate scheduled/background process with a SQL account that can read the master tenant catalog and apply the required DDL in tenant databases. Do not expose this worker as a public API or run it inside a web request.

## Operational notes

- Back up tenant databases before deploying a release containing schema changes.
- Test every migration against a restored copy of a tenant database before production.
- Deploy application code only after the required migration is available and the worker has completed successfully.
- Review worker output for failed tenants; the process currently reports failures in logs and continues the cycle.
- This worker updates `TenantDatabases.SchemaVersion` from the tenant's actual migration ledger after processing.
- This worker deliberately does not repair a missing/NULL V1 checksum or attempt to infer whether the initial schema is complete.
