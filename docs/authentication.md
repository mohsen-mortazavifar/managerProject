# Authentication and session setup

## Implemented endpoints

- `POST /api/auth/login`: accepts JSON `{ "email": "...", "password": "..." }`; returns the public user fields and sets an opaque session cookie.
- `GET /api/auth/me`: returns the current authenticated user or HTTP 401.
- `POST /api/auth/logout`: revokes the current database session and clears the cookie.

All endpoints run in the Node.js runtime. Responses containing user/session state are marked `Cache-Control: no-store`.

## Required one-time database setup

1. Review `docs/create-user-sessions.sql`.
2. Run it manually against the central database.
3. Confirm `dbo.UserSessions` exists before testing login.

The app stores only a SHA-256 digest of each random session token in the database. The raw token is sent only as an `HttpOnly` cookie. Sessions expire after seven days and can be revoked at logout. User deactivation or soft deletion also prevents an existing session from authenticating.

The migration is not run automatically by the app and does not alter `dbo.Users`.

## Password hashes

The verifier supports:
- The application's `$scrypt$...` format.
- ASP.NET Core Identity V2 and V3 encoded password hashes.

Unknown hash formats fail closed. If existing `Users.PasswordHash` values use bcrypt, PBKDF2 in a custom format, or another library's encoding, login will not work until a reviewed compatibility path or password-reset/migration flow is added. Do not store plaintext passwords or copy production hashes into source control.

For new password hashes, `hashPassword` in `src/lib/auth/password.ts` creates scrypt hashes and enforces a minimum length of 12 characters. A user-registration or password-reset workflow is not included yet.

## Security notes before public production deployment

- Configure HTTPS. The session cookie uses `Secure` in production, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- Keep SQL credentials in deployment environment variables, never in Git.
- Add shared, persistent login rate limiting / lockout at the application or trusted edge layer before exposing the login endpoint publicly.
- Configure trusted proxy behavior before relying on forwarded IP headers for audit or rate limiting.
- Review the database schema's primary/foreign key results; the user has so far confirmed the table/column counts and unique indexes only.
- Build and integration-test in the target environment with a test account before deployment. This repository update has not been built or tested against the user's SQL Server from this environment.

## API examples

Login:

```http
POST /api/auth/login
Content-Type: application/json

{"email":"user@example.com","password":"your-password"}
```

Current session:

```http
GET /api/auth/me
```

Logout:

```http
POST /api/auth/logout
```
