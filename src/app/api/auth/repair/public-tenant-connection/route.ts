import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
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

/**
 * Server-to-server tenant resolution for the public repair-tracking page.
 * The integration key is never exposed to the browser. No tenant SQL credentials
 * are returned from a browser-facing endpoint.
 */
export async function POST(request: Request) {
  if (!serviceAllowed(request)) return respond({ error: "Unauthorized service." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid request." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: "Invalid request." }, 400);
  }

  const input = body as { tenantCode?: unknown };
  const tenantCode = typeof input.tenantCode === "string" ? input.tenantCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9_-]{2,50}$/.test(tenantCode)) {
    return respond({ error: "Invalid tenant code." }, 400);
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("tenantCode", sql.NVarChar(50), tenantCode)
      .query(`
        SELECT TOP (1)
          td.TenantDatabaseId, td.ServerName, td.DatabaseName,
          td.SqlLoginName, td.SqlPasswordEncrypted
        FROM dbo.Tenants t
        INNER JOIN dbo.TenantDatabases td ON td.TenantId = t.TenantId
        WHERE t.Code = @tenantCode
          AND t.DeletedAt IS NULL
          AND t.Status = N'Active'
          AND td.IsActive = 1
        ORDER BY td.CreatedAt DESC, td.TenantDatabaseId DESC;
      `);

    const row = result.recordset[0];
    if (!row) return respond({ error: "Tenant is not available." }, 404);
    if (typeof row.SqlLoginName !== "string" || !row.SqlLoginName.trim() ||
        typeof row.SqlPasswordEncrypted !== "string" || !row.SqlPasswordEncrypted.trim()) {
      return respond({ error: "Tenant database credentials have not been provisioned." }, 503);
    }

    const server = String(row.ServerName ?? "").trim();
    const database = String(row.DatabaseName ?? "").trim();
    const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433;
    if (!server || !/^[A-Za-z0-9_$-]{1,128}$/.test(database) ||
        !Number.isInteger(port) || port < 1 || port > 65535) {
      return respond({ error: "Tenant database configuration is invalid." }, 503);
    }

    const password = decryptTenantConnectionPayload(String(row.SqlPasswordEncrypted));
    if (!password) return respond({ error: "Tenant database credentials are invalid." }, 503);

    return respond({
      connectionConfig: {
        server,
        port,
        database,
        user: String(row.SqlLoginName),
        password,
        options: {
          encrypt: process.env.DB_ENCRYPT !== "false",
          trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
        },
      },
    });
  } catch (error) {
    console.error("Public tracking tenant resolution failed", error instanceof Error ? error.message : "Unknown error");
    return respond({ error: "Tenant database could not be resolved." }, 503);
  }
}
