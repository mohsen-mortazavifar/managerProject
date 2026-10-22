# JWT authentication setup

## Endpoints

- `POST /api/auth/login`: accepts JSON `{ "email": "...", "password": "..." }` and returns a signed access token and public user details.
- `GET /api/auth/me`: validates the JWT from the `Authorization: Bearer <token>` header and returns the authenticated user.
- `POST /api/auth/logout`: returns a consistent logout response. Because access JWTs are stateless, the client must discard its token; this endpoint does not revoke a previously issued token.

## Configuration

Set `JWT_SECRET` in the server environment to a cryptographically random secret of at least 32 bytes. Generate one, for example, with:

```bash
openssl rand -base64 48
```

Do not commit the real secret to Git. If the secret is missing or too short, token creation fails closed and login returns a service-unavailable response.

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

## Limitations before production

- Stateless access JWTs cannot be individually revoked before expiry. A compromised token remains usable until expiry unless a revocation mechanism or very short-lived tokens with refresh-token rotation are added.
- Add shared persistent login rate limiting/lockout before public exposure.
- Confirm the current `Users.PasswordHash` encoding is supported by `src/lib/auth/password.ts`.
- Build and test against a non-production account and the target SQL Server; repository changes have not yet been run against the user's environment.
- Tenant-level authorization, refresh tokens, password reset, and registration are not implemented yet.
