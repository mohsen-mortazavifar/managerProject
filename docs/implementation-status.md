# Repair Master implementation status

## Phase 1 — application foundation

- [x] Shared SQL Server connection pool and environment-based configuration.
- [x] `GET /api/health` for central database connectivity.
- [x] Read-only table/column preflight at `docs/validate-schema.sql`; user reported 11/11 tables and 92/92 columns found.
- [x] Read-only constraint audit at `docs/audit-schema-constraints.sql`; user reported unique indexes for `Users.Email` and `Tenants.Code`.
- [x] Email/password login endpoint: `POST /api/auth/login`.
- [x] Current-session endpoint: `GET /api/auth/me`.
- [x] Logout and server-side session revocation: `POST /api/auth/logout`.
- [x] Opaque random session tokens, SHA-256 token digests in SQL Server, seven-day expiry, HttpOnly cookie, SameSite=Lax, and Secure cookie in production.
- [x] Password hash creation using scrypt and verification for this format plus ASP.NET Core Identity V2/V3 formats.
- [x] Manual SQL script to create `dbo.UserSessions`: `docs/create-user-sessions.sql`.
- [x] Setup and security notes: `docs/authentication.md`.
- [ ] Run `docs/create-user-sessions.sql` manually against the central database.
- [ ] Confirm the existing `Users.PasswordHash` encoding is compatible with the verifier.
- [ ] Add shared persistent login rate limiting/lockout before public production exposure.
- [ ] Review the primary-key and foreign-key result sets from the constraints audit.
- [ ] Build and integration-test against the target SQL Server.
- [ ] Add password reset, registration, and tenant-level authorization.

## Authentication rollout

1. Review and manually run `docs/create-user-sessions.sql` in the central database. The application does not run migrations automatically.
2. Configure the existing SQL environment variables in the deployment environment; never commit credentials.
3. Test `POST /api/auth/login`, `GET /api/auth/me`, and `POST /api/auth/logout` using a non-production test account.
4. Existing password hashes must be in the application's `$scrypt$...` format or ASP.NET Core Identity V2/V3 format. Unknown formats fail closed; do not change stored hashes without a planned migration/reset.
5. Add shared, persistent login rate limiting before exposing login publicly.

## Security and verification notes

The session cookie is HttpOnly, SameSite=Lax, and Secure when `NODE_ENV=production`. Only the token digest is stored in the database. Inactive or soft-deleted users cannot authenticate through an existing session, and logout revokes the server-side session.

The user reported that 11 expected tables and 92 expected columns exist, and that unique indexes exist for `Users.Email` and `Tenants.Code`. Primary-key and foreign-key audit results have not yet been supplied.

These repository changes have been committed to `manager-agent1`, but the project has not been built or tested against the user's SQL Server from this environment. Session login will return a service-unavailable response until the session table exists and valid database settings are configured.
