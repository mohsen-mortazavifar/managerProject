import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { getBearerToken, verifyAccessToken } from "@/lib/auth/jwt";
import { decryptTenantConnectionPayload } from "@/lib/tenant-connection-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

function serviceAllowed(request: Request): boolean {
  const expected = process.env.REPAIR_INTEGRATION_SECRET ?? "";
  const supplied = request.headers.get("x-repair-integration-key") ?? "";
  if (Buffer.byteLength(expected, "utf8") < 32) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!serviceAllowed(request)) return respond({ error: "Unauthorized service." }, 401);

  const token = getBearerToken(request);
  const user = token ? verifyAccessToken(token) : null;
  if (!user || user.isSystemAdmin || user.isPlatformUser) {
    return respond({ error: "Invalid access token." }, 401);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid request." }, 400);
  const input = body as { tenantId?: unknown; tenantDatabaseId?: unknown };
  if (typeof input.tenantId !== "string" || !/^\d{1,19}$/.test(input.tenantId) ||
      typeof input.tenantDatabaseId !== "string" || !/^\d{1,19}$/.test(input.tenantDatabaseId)) {
    return respond({ error: "Invalid tenant database request." }, 400);
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("userId", sql.BigInt, user.userId)
      .input("tenantId", sql.BigInt, input.tenantId)
      .input("tenantDatabaseId", sql.BigInt, input.tenantDatabaseId)
      .query(`
        SELECT TOP (1) td.ConnectionStringEncrypted, td.ServerName, td.DatabaseName
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
        INNER JOIN dbo.TenantDatabases td ON td.TenantId = t.TenantId
        WHERE tu.UserId = @userId
          AND tu.TenantId = @tenantId
          AND tu.IsActive = 1
          AND t.DeletedAt IS NULL
          AND t.Status = N'Active'
          AND td.TenantDatabaseId = @tenantDatabaseId
          AND td.IsActive = 1;
      `);

    const encrypted = result.recordset[0]?.ConnectionStringEncrypted;
    if (typeof encrypted !== "string" || !encrypted.trim()) {
      return respond({ error: "Tenant database connection is not configured for the current encryption format." }, 503);
    }

    const connectionConfig = JSON.parse(decryptTenantConnectionPayload(encrypted)) as {
      server?: unknown; port?: unknown; database?: unknown; user?: unknown; password?: unknown;
      options?: { encrypt?: unknown; trustServerCertificate?: unknown };
    };
    const row = result.recordset[0];
    if (typeof connectionConfig.server !== "string" ||
        connectionConfig.server.toLowerCase() !== String(row.ServerName ?? "").trim().toLowerCase() ||
        typeof connectionConfig.database !== "string" ||
        connectionConfig.database !== String(row.DatabaseName ?? "") ||
        typeof connectionConfig.user !== "string" || !connectionConfig.user ||
        typeof connectionConfig.password !== "string" || !connectionConfig.password ||
        typeof connectionConfig.port !== "number" || !Number.isInteger(connectionConfig.port) ||
        connectionConfig.port < 1 || connectionConfig.port > 65535 ||
        typeof connectionConfig.options?.encrypt !== "boolean" ||
        typeof connectionConfig.options?.trustServerCertificate !== "boolean") {
      return respond({ error: "Stored tenant connection configuration is invalid." }, 503);
    }
    return respond({ connectionConfig });
  } catch (error) {
    console.error("Tenant connection resolution failed", error instanceof Error ? error.message : "Unknown error");
    return respond({ error: "Tenant database connection could not be resolved." }, 503);
  }
}
