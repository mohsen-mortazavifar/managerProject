# Repair Master implementation status

## Phase 1 — application foundation

- [x] Add a shared SQL Server connection pool using the existing `mssql` dependency.
- [x] Read database settings from environment variables; do not store credentials in source control.
- [x] Add `GET /api/health` to check connectivity to the central database without returning sensitive error details.
- [x] Add a read-only SQL Server schema preflight script at `docs/validate-schema.sql`.
- [ ] Run the schema preflight against the target database and review missing tables/columns.
- [ ] Add and verify the first database migrations.
- [ ] Implement authentication and secure sessions.
- [ ] Implement tenant registration and durable provisioning jobs.
- [ ] Add the platform administration UI and role-based authorization.

## Validation procedure

1. Select the intended central database in SQL Server Management Studio (SSMS).
2. Open and execute `docs/validate-schema.sql`.
3. Review the first two result sets for missing tables and columns. In the final result set, `FoundTableCount` should equal `ExpectedTableCount`, and `FoundExpectedColumnCount` should equal `ExpectedColumnCount`.
4. Share the result counts and any missing names before migrations or authentication work is based on an assumed schema.

The script is read-only: it queries SQL Server catalog metadata and does not create, alter, or delete database objects.

## Important schema note

The database table definitions supplied in the task and the PDF implementation specification do not fully match. For example, the supplied database uses `Roles`, `UserRoles`, and `TenantDatabases.ConnectionStringEncrypted`, while the PDF describes a different set of identity, role, and database-reference tables. Before generating migrations or implementing features that depend on those differences, confirm which schema is the source of truth. This phase does not modify or migrate the database.

## Verification status

The script has been committed to the repository, but it has not been executed against the user's SQL Server from this environment. Database connectivity and schema conformity therefore remain unverified.
