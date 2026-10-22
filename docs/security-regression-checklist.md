# Security and authentication regression checklist

Run against a non-production database and account after applying both SQL scripts.

## Database prerequisites

- [ ] Review and run `docs/create-auth-login-attempts.sql`.
- [ ] Review and run `docs/create-revoked-access-tokens.sql`.
- [ ] Configure a random `JWT_SECRET` of at least 32 bytes.
- [ ] Set `TRUST_PROXY_HEADERS=true` only when a trusted reverse proxy overwrites forwarding headers. Otherwise leave it false and confirm the deployment has another IP-level control.

## Authentication tests

1. Submit valid credentials to `POST /api/auth/login`: expect 200, a short-lived access token, and `Cache-Control: no-store`.
2. Submit a wrong password: expect 401 with a generic credential error.
3. Submit malformed JSON or invalid email: expect 400.
4. Call `GET /api/auth/me` without a token: expect 401.
5. Call `GET /api/auth/me` with a valid token: expect 200.
6. Call `POST /api/auth/logout` with that token: expect 200.
7. Call `GET /api/auth/me` again with the same token: expect 401 because it was revoked.
8. Call `POST /api/auth/logout` without a token or with an invalid token: expect 401.
9. Disable a test account or set `DeletedAt`: protected API calls should return 401.
10. Use a valid non-admin test account: `/api/tenants` should return 403.
11. As an admin, test `GET/POST /api/tenants` and `GET/PATCH /api/tenants/:tenantId`; verify valid requests succeed and malformed inputs are rejected.
12. Send repeated failed logins from the same normalized email: after the configured threshold, expect 429 and `Retry-After`.
13. If trusted proxy mode is enabled, verify changing a client-supplied forwarding header cannot bypass IP rate limiting. Test this at the deployed proxy, not only localhost.

## Build and static checks

Run locally after pulling the branch:

```powershell
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

The repository currently does not define an automated test script. Do not mark runtime tests complete until the checks above have been executed against the target Next.js and SQL Server environment.
