# SSO integration (Next.js business application)

This repository implements the authentication-service side of a one-time authorization-code flow. It does not send SQL credentials or the central JWT to the browser of the second application.

## Environment

Configure these values in the authentication project's private `.env.local` / deployment environment. Never use `NEXT_PUBLIC_` for them.

- `AUTH_BASE_URL`: public base URL of this authentication app.
- `BUSINESS_APP_BASE_URL`: public base URL of the separate Next.js app.
- `BUSINESS_APP_CALLBACK_URL`: exact callback URL in the business app, e.g. `https://app.example.com/auth/callback`.
- `SSO_CLIENT_SECRET`: random server-to-server secret, at least 32 bytes. Configure the same value only in the server environment of the business app.

Use HTTPS in production. `.env.example` contains local-only examples; replace them for deployment.

## Database setup

Apply `database/migrations/20261023_create_sso_authorization_codes.sql` once to the central `Repair_Master` database before using these endpoints.

## Flow

1. The business app creates a cryptographically random `state` (at least 32 URL-safe characters), stores it in a short-lived, HttpOnly, Secure, SameSite=Lax cookie/session, then redirects the browser to the configured authentication app's sign-in page.
2. After the user has signed in to the authentication app, the browser calls `POST /api/sso/authorize` with the existing bearer access token and JSON `{ "state": "<state>" }`.
3. The endpoint verifies the current account and active tenant membership, creates a random one-time code valid for 60 seconds, stores only SHA-256 hashes of code and state, and returns `authorizationUrl`. The browser navigates to that URL.
4. The business app's callback validates that returned `state` matches the state saved in its own session. On the server only, it sends `POST https://<auth-host>/api/sso/exchange` with JSON `{ "code": "...", "state": "..." }` and header `x-sso-client-secret: <secret>`.
5. On success, the callback creates its own application session (prefer an HttpOnly, Secure, SameSite cookie) and redirects to the app. Do not put the central access token or client secret in the URL, HTML, browser storage, or client-side code.

## Endpoints

- `POST /api/sso/authorize` — requires `Authorization: Bearer <central access token>`; accepts a `state`; returns a callback URL containing one-time `code` and `state`.
- `POST /api/sso/exchange` — server-to-server only; requires `x-sso-client-secret`; accepts `code` and `state`; returns verified user and active tenant metadata, never database credentials.

The authorization code is single-use and bound to the state hash. The exchange response is not a replacement for the business app's own session. Re-check membership/permissions for protected business APIs and keep tenant access server-side.

## Important limitations before production

- The business app must implement the callback, state-cookie validation, its own session and logout flow.
- The business app's server must keep `SSO_CLIENT_SECRET` secret. If the business app is a separately deployed application, provision a unique high-entropy secret and rotate it when exposed.
- Rate-limit the endpoints at the trusted edge/application layer and monitor failed exchanges.
- The code has not been verified by running the repository's build, lint, or integration tests in this change. Run `npm ci`, `npm run lint`, `npx tsc --noEmit`, and test against a non-production database before merge.
