import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSqlPool, sql } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";
import { normalizeMobile } from "@/lib/auth/otp";
import { checkLoginRateLimit, getLoginClientIp, recordLoginAttempt } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceAllowed(request: Request) {
  const expected = process.env.REPAIR_INTEGRATION_SECRET ?? "";
  const supplied = request.headers.get("x-repair-integration-key") ?? "";
  if (Buffer.byteLength(expected, "utf8") < 32) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const respond = (data: object, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(request: Request) {
  if (!serviceAllowed(request)) return respond({ error: "Unauthorized service." }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid request." }, 400);

  const input = body as { mobile?: unknown; password?: unknown };
  if (typeof input.mobile !== "string" || typeof input.password !== "string" ||
      input.password.length < 1 || input.password.length > 1024) {
    return respond({ error: "Invalid credentials." }, 400);
  }

  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); } catch {
    return respond({ error: "Mobile or password is incorrect." }, 401);
  }
  const ip = getLoginClientIp(request);

  try {
    const limit = await checkLoginRateLimit(mobile, ip);
    if (!limit.allowed) return respond({ error: "Too many login attempts." }, 429);
    const pool = await getSqlPool();
    const result = await pool.request().input("mobile", sql.NVarChar(40), mobile).query(`
      SELECT TOP (1) UserId, Mobile, Email, PasswordHash, FullName, IsActive,
        IsSystemAdmin, IsPlatformUser, MobileVerifiedAt
      FROM dbo.Users WHERE Mobile=@mobile AND DeletedAt IS NULL;
    `);
    const user = result.recordset[0];
    const valid = user?.PasswordHash ? await verifyPassword(input.password, String(user.PasswordHash)) : false;
    if (!user || !valid || !Boolean(user.IsActive) || !user.MobileVerifiedAt ||
        Boolean(user.IsSystemAdmin) || Boolean(user.IsPlatformUser)) {
      await recordLoginAttempt(mobile, ip, false, request);
      return respond({ error: "Mobile or password is incorrect." }, 401);
    }

    const found = await pool.request().input("userId", sql.BigInt, user.UserId).query(`
      ;WITH ActiveTenantDatabases AS (
        SELECT TenantDatabaseId, TenantId, DatabaseName, ServerName, SchemaVersion, CreatedAt,
          ROW_NUMBER() OVER (
            PARTITION BY TenantId
            ORDER BY CreatedAt DESC, TenantDatabaseId DESC
          ) AS RowNumber
        FROM dbo.TenantDatabases
        WHERE IsActive = 1
      )
      SELECT tu.TenantUserId, tu.TenantId, tu.IsOwner, t.Name AS TenantName, t.Code AS TenantCode,
        td.TenantDatabaseId, td.DatabaseName, td.ServerName, td.SchemaVersion
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId=tu.TenantId
      INNER JOIN ActiveTenantDatabases td ON td.TenantId=t.TenantId AND td.RowNumber=1
      WHERE tu.UserId=@userId AND tu.IsActive=1 AND t.Status=N'Active' AND t.DeletedAt IS NULL
      ORDER BY tu.IsOwner DESC, tu.TenantUserId;
    `);
    if (found.recordset.length === 0) {
      await recordLoginAttempt(mobile, ip, false, request);
      return respond({ error: "No active business database is assigned to this account." }, 403);
    }
    if (found.recordset.length > 1) {
      return respond({ error: "Multiple active businesses require explicit selection.", code: "MULTIPLE_ACTIVE_TENANTS" }, 409);
    }

    const m = found.recordset[0];
    if (!String(m.DatabaseName ?? "").trim() || !String(m.ServerName ?? "").trim()) {
      return respond({ error: "Business database configuration is incomplete." }, 503);
    }
    const publicUser = {
      userId: String(user.UserId), email: user.Email == null ? "" : String(user.Email),
      fullName: String(user.FullName), isSystemAdmin: false, isPlatformUser: false,
    };
    const accessToken = createAccessToken(publicUser);
    await recordLoginAttempt(mobile, ip, true, request);
    return respond({
      accessToken, tokenType: "Bearer", expiresIn: JWT_TTL_SECONDS, user: publicUser,
      membership: {
        tenantUserId: String(m.TenantUserId), tenantId: String(m.TenantId),
        isOwner: Boolean(m.IsOwner), tenantName: String(m.TenantName), tenantCode: String(m.TenantCode),
      },
      database: {
        tenantDatabaseId: String(m.TenantDatabaseId), databaseName: String(m.DatabaseName),
        serverName: String(m.ServerName), schemaVersion: m.SchemaVersion == null ? null : String(m.SchemaVersion),
      },
    });
  } catch (error) {
    console.error("Repair integration login failed", error);
    return respond({ error: "Master authentication is temporarily unavailable." }, 503);
  }
}
