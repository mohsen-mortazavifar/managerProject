# JWT authentication setup

## Endpoints

- `POST /api/auth/login`: accepts JSON `{ "email": "...", "password": "..." }` and returns a signed access token and public user details.
- `GET /api/auth/me`: validates the JWT from the `Authorization: Bearer <token>` header and returns the authenticated user.
- `POST /api/auth/logout`: requires the current Bearer token and records its SHA-256 hash in `dbo.RevokedAccessTokens`. Subsequent protected requests reject that token. The client clears its local token even if the network is unavailable; if the server cannot revoke it, the token remains valid until expiry.

## Configuration

Set `JWT_SECRET` in the server environment to a cryptographically random secret of at least 32 bytes. Generate one, for example, with:

```bash
openssl rand -base64 48
```

Do not commit the real secret to Git. If the secret is missing or too short, token creation fails closed and login returns a service-unavailable response.

## Login rate limiting

Before enabling the updated login endpoint, review and manually run
`docs/create-auth-login-attempts.sql` against the application database. It
creates the `dbo.AuthLoginAttempts` table and its supporting indexes; no database
migration is run automatically by the application.

The login endpoint counts failed attempts over a rolling 15-minute window and
returns HTTP 429 with a `Retry-After` header after 8 failures for one normalized
email address or 30 failures from one client IP. Email and IP values are stored
as SHA-256 hashes; user-agent values are truncated. Successful attempts are
recorded but excluded from failure counts.

The app reads `x-real-ip` or the first `x-forwarded-for` value only when `TRUST_PROXY_HEADERS=true`; it also validates that the value is an IP address. Keep this setting false unless a trusted reverse proxy overwrites these headers and direct client-supplied values cannot reach the app. When false, the email-based limit remains active but IP-based limiting is unavailable. If the rate-limit table is missing or SQL Server is unavailable, login fails closed with HTTP 503 until the configuration issue is fixed.

The table will accumulate records over time. Schedule a reviewed retention job
to delete old records (for example, records older than 30 days) and monitor its
size before production deployment.

## Token policy

- Algorithm: HS256 (HMAC-SHA256), explicitly checked during verification.
- Issuer: `repair-master`.
- Audience: `repair-master-api`.
- Access-token lifetime: 15 minutes.
- Signature comparison uses a timing-safe comparison.
- The API expects the token in the Authorization header, not a cookie.
- Responses carrying authentication state use `Cache-Control: no-store`.

## API examples

Login:

```http
POST /api/auth/login
Content-Type: application/json

{"email":"user@example.com","password":"your-password"}
```

Successful login returns `accessToken`, `tokenType: "Bearer"`, `expiresIn`, and `user`.

Call an authenticated endpoint:

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

Logout:

```http
POST /api/auth/logout
```

The client must delete its access token on logout. Do not store JWTs in localStorage if an XSS-resistant storage strategy is available; for a browser SPA, prefer keeping short-lived access tokens in memory. Always use HTTPS in production.

## Token revocation migration\n\nBefore deploying token-revocation code, review and manually run `docs/create-revoked-access-tokens.sql` against the application database. The application does not create tables automatically. Expired revocation records can be removed by a scheduled retention job, for example daily with `DELETE FROM dbo.RevokedAccessTokens WHERE ExpiresAt <= SYSUTCDATETIME();`.\n\n## Limitations before production

- Revocation is checked against SQL Server on each protected request, so database availability is required for protected operations. The current design does not implement refresh-token rotation.
- Add shared persistent login rate limiting/lockout before public exposure.
- Confirm the current `Users.PasswordHash` encoding is supported by `src/lib/auth/password.ts`.
- Build and test against a non-production account and the target SQL Server; repository changes have not yet been run against the user's environment.
- Tenant-level authorization, refresh tokens, password reset, and registration are not implemented yet.
