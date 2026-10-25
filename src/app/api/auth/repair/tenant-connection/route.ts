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
  if (!user || user.isSystemAdmin) return respond({ error: "Invalid access token." }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid request." }, 400);
  const input = body as { tenantId?: unknown; tenantDatabaseId?: unknown };
  if (typeof input.tenantId !== "string" || !/^\\d{1,19}$/.test(input.tenantId) ||
      typeof input.tenantDatabaseId !== "string" || !/^\\d{1,19}$/.test(input.tenantDatabaseId)) {
    return respond({ error: "Invalid tenant database request." }, 400);
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("userId", sql.BigInt, user.userId)
      .input("tenantId", sql.BigInt, input.tenantId)
      .input("tenantDatabaseId", sql.BigInt, input.tenantDatabaseId)
      .query(`
        SELECT TOP (1)
          td.TenantDatabaseId, td.ServerName, td.DatabaseName,
          td.SqlLoginName, td.SqlPasswordEncrypted
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

    const row = result.recordset[0];
    if (!row) return respond({ error: "Tenant database access is not active for this user." }, 403);
    if (typeof row.SqlLoginName !== "string" || !row.SqlLoginName.trim() ||
        typeof row.SqlPasswordEncrypted !== "string" || !row.SqlPasswordEncrypted.trim()) {
      return respond({ error: "Tenant-specific SQL credentials have not been provisioned." }, 503);
    }

    const server = String(row.ServerName ?? "").trim();
    const database = String(row.DatabaseName ?? "").trim();
    const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433;
    const password = decryptTenantConnectionPayload(row.SqlPasswordEncrypted);

    if (!server || !/^[A-Za-z0-9_$-]{1,128}$/.test(database) ||
        !Number.isInteger(port) || port < 1 || port > 65535 || !password) {
      return respond({ error: "Stored tenant SQL credentials are invalid." }, 503);
    }

    return respond({
      connectionConfig: {
        server,
        port,
        database,
        user: row.SqlLoginName,
        password,
        options: {
          encrypt: process.env.DB_ENCRYPT !== "false",
          trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
        },
      },
    });
  } catch (error) {
    console.error("Tenant connection resolution failed", error instanceof Error ? error.message : "Unknown error");
    return respond({ error: "Tenant database connection could not be resolved." }, 503);
  }
}
