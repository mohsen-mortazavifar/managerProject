# Repair Master implementation status

## Application foundation

- [x] Shared SQL Server connection pool and environment-based configuration.
- [x] `GET /api/health` for central database connectivity.
- [x] Read-only table/column preflight at `docs/validate-schema.sql`; user reported 11/11 tables and 92/92 columns found.
- [x] Read-only constraint audit at `docs/audit-schema-constraints.sql`; user reported unique indexes for `Users.Email` and `Tenants.Code`.
- [x] Email/password login endpoint: `POST /api/auth/login`.
- [x] JWT Bearer authentication for `GET /api/auth/me`.
- [x] Stateless logout endpoint: `POST /api/auth/logout`.
- [x] HS256 signature validation, issuer/audience checks, 15-minute expiry, and `JWT_SECRET` environment configuration.
- [x] Password hash creation using scrypt and verification for this format plus ASP.NET Core Identity V2/V3 formats.
- [x] JWT configuration and API examples in `docs/authentication.md`.
- [ ] Configure a strong `JWT_SECRET` in the deployment environment.
- [ ] Confirm the existing `Users.PasswordHash` encoding is compatible with the verifier.
- [x] Add SQL-backed login rate limiting: 8 failed attempts per email or 30 per client IP in a rolling 15-minute window.
- [ ] Review and manually run `docs/create-auth-login-attempts.sql` before enabling login in the target environment.
- [ ] Configure the trusted reverse proxy to overwrite client IP headers and schedule retention cleanup for login-attempt records.
- [ ] Review the primary-key and foreign-key result sets from the constraints audit.
- [ ] Build and integration-test against the target SQL Server, including HTTP 401/429/503 behavior.
- [ ] Add refresh-token rotation/revocation if needed, password reset, registration, and tenant-level authorization.

## JWT usage

1. Configure `JWT_SECRET` using a cryptographically random secret of at least 32 bytes. Do not commit the real secret.
2. Call `POST /api/auth/login` with email and password; the response returns `accessToken` and `expiresIn`.
3. Send `Authorization: Bearer <accessToken>` to protected API endpoints.
4. Access tokens expire after 15 minutes. Since they are stateless, logout requires the client to discard its token; a stolen token cannot be individually revoked before expiry without a revocation mechanism.

## Verification notes

The user reported that 11 expected tables and 92 expected columns exist, and that unique indexes exist for `Users.Email` and `Tenants.Code`. Primary-key and foreign-key audit results have not yet been supplied.

The previous database-backed session implementation and its proposed `UserSessions` SQL migration have been removed from this branch. The authentication code now uses JWT Bearer tokens and does not set session cookies or require a `UserSessions` table.

These changes have been committed to `manager-agent1`, but the project has not been built or tested against the user's SQL Server from this environment.
