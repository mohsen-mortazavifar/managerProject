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

## Current canonical tenant migration sequence

The currently released baseline is V1 through V14. This branch already contains
V15 (repair-order internal serial), which is the next migration after the server's
currently reported V14. The additional migrations in this branch continue from V16;
do not renumber V15 or apply V16 before it.

| Version | File | Purpose |
|---|---|---|
| V15 | `V15_20261126_AddRepairOrderInternalSerial.sql` | Optional unique internal serial on each repair order |
| V16 | `V16_20261126_AddDeviceStoreSerial.sql` | Store serial on reusable device records |
| V17 | `V17_20261122_AddReceiptTrackingLinkPreference.sql` | Per-receipt opt-in for public tracking link SMS |
| V18 | `V18_20261123_AddRepairWarranty.sql` | Warranty policies, issued warranties, claims and permissions |
| V19 | `V19_20261123_ExtendRepairWarrantyOperations.sql` | Revocation audit, claim-line decisions and WarrantyIssued template |
| V20 | `V20_20261125_AddOrderServiceReminderPreferences.sql` | Per-order opt-in and selected reminder interval |
| V21 | `V21_20261127_AddTenantReminderEventRules.sql` | Tenant-owned reminder event rules and event inbox schema |
| V22 | `V22_20261127_SeedRepairCompletedReminderRule.sql` | Initial RepairCompleted rule matching the Repair event payload |
| V23 | `V23_20261127_AddReminderEventCancellationLimits.sql` | Cancellation event mapping and occurrence limit |
| V24 | `V24_20261127_MoveReminderTablesToNotification.sql` | Move legacy tenant outbox/schedule/inbox tables into notification |
| V25 | `V25_20261127_AddOrderSelectedServiceReminderDelay.sql` | One-time 3/6/12-month delay selected on each repair order |
| V26 | `V26_20261127_AddReminderOccurrences.sql` | Materialized reminder occurrences and scheduler counter |
| V27 | `V27_20261127_AddSmsDeliveryLogs.sql` | Tenant-local SMS delivery history and sync keys |
| V28 | `V28_20261127_EnforceFiniteReminderRecurrence.sql` | Finite recurrence cap for existing and new schedules |
| V29 | `V29_20261127_UpdateServiceReminderMessageTemplate.sql` | Current RepairCompleted reminder text and payload placeholders |
| V30 | `V30_20261127_AddRepairSmsTemplatesAndBranchContacts.sql` | Delivered template and branch contact placeholders in Repair SMS templates |

The migration worker discovers V2+ files by their numeric prefix and requires a
contiguous sequence. It will stop before changing a tenant if a version is missing.
Keep this folder as the canonical source for all new tenant schema changes. Do not
copy new tenant DDL into Repair's ad-hoc `database/scripts` folder or TaskFlow's
tenant scripts as a second independently executable migration chain.

The TaskFlow reminder migrations in V21-V29 are deliberately incorporated here
because the tables they create are in the Repair tenant operational database.
The TaskFlow central database migrations remain a separate chain and must not be
run against tenant databases.

### Deployment notes for this branch

- The production list supplied for this review ends at V14. V15 is present in this
  branch but is not in that supplied production list; verify the tenant ledger and
  master `SchemaVersion` before rollout.
- New tenant provisioning applies V1 and then V2-V30 automatically using this folder.
- Existing tenants are advanced by the tenant migration worker. Back up tenant DBs
  before rollout and inspect failures; never edit an already-recorded migration.
- V24 intentionally aborts if both old and new schema copies exist. Reconcile those
  tables and data manually before retrying rather than allowing a silent overwrite.
- V25 invalidates the previous fixed-delay schedules for the RepairCompleted rule.
  This is intentional because the new reminder interval is selected per repair order.
