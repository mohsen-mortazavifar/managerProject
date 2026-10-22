# Repair Master implementation status

## Phase 1 — application foundation

- [x] Add a shared SQL Server connection pool using the existing `mssql` dependency.
- [x] Read database settings from environment variables; do not store credentials in source control.
- [x] Add `GET /api/health` to check connectivity to the central database without returning sensitive error details.
- [x] Add a read-only table/column preflight script at `docs/validate-schema.sql`.
- [x] Record the user's reported preflight result: 11/11 expected tables and 92/92 expected columns were found.
- [x] Add a read-only primary-key, foreign-key, and identity uniqueness audit at `docs/audit-schema-constraints.sql`.
- [ ] Run the constraints audit against the target database and review any findings.
- [ ] Verify column types, nullability, defaults, and foreign-key definitions against the intended schema.
- [ ] Add and verify migrations only after schema and constraints are confirmed.
- [ ] Implement authentication and secure sessions.
- [ ] Implement tenant registration and durable provisioning jobs.
- [ ] Add platform administration UI and role-based authorization.

## Validation procedure

1. Select the intended central database in SQL Server Management Studio (SSMS).
2. Run `docs/validate-schema.sql`. The user reported 11 expected tables, 11 found tables, 92 expected columns, and 92 found columns.
3. Run `docs/audit-schema-constraints.sql` and review its three result sets: missing primary keys, missing expected foreign-key relationships, and unique-index findings for `Users.Email` and `Tenants.Code`.
4. Share the results before schema migrations or authentication are implemented.

Both SQL scripts are read-only: they query SQL Server catalog metadata and do not create, alter, or delete database objects.

## Important schema note

The supplied database definitions and a previously referenced PDF implementation specification do not fully match. For example, the supplied schema uses `Roles`, `UserRoles`, and `TenantDatabases.ConnectionStringEncrypted`, while the PDF describes a different set of identity, role, and database-reference tables. Confirm the source of truth before generating migrations or implementing features that depend on those differences.

## Verification status

The user-reported table/column counts match the expected names. The constraints audit has been committed but has not yet been executed against the user's SQL Server from this environment. Database connectivity, exact data types, nullability, defaults, and constraint definitions remain unverified.
