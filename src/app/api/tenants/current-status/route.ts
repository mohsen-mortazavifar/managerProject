import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.user.isSystemAdmin) {
    return NextResponse.json(
      { error: "این وضعیت مخصوص کاربران فضای کسب‌وکار است." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("userId", sql.BigInt, auth.user.userId)
      .query(`
        SELECT TOP (1)
          u.FullName AS OwnerFullName, u.Mobile AS OwnerMobile, u.Email AS OwnerEmail,
          t.TenantId, t.Name, t.Code, t.Status AS TenantStatus, t.CreatedAt AS TenantCreatedAt,
          td.DatabaseName, td.IsActive AS DatabaseIsActive, td.SchemaVersion,
          pj.Status AS JobStatus, pj.AttemptCount, pj.MaxAttempts,
          pj.LastErrorCode, pj.CorrelationId , COALESCE(pj.CompletedAt, pj.StartedAt, pj.CreatedAt) AS JobUpdatedAt,
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Users u ON u.UserId = tu.UserId AND u.DeletedAt IS NULL
        INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId AND t.DeletedAt IS NULL
        LEFT JOIN dbo.TenantDatabases td ON td.TenantId = t.TenantId
        LEFT JOIN dbo.ProvisioningJobs pj ON pj.TenantDatabaseId = td.TenantDatabaseId
        WHERE tu.UserId = @userId
          AND tu.IsActive = 1
        ORDER BY tu.IsOwner DESC, t.CreatedAt DESC, pj.CreatedAt DESC;
      `);

    const row = result.recordset[0];
    if (!row) {
      return NextResponse.json(
        { error: "برای این حساب فضای کسب‌وکاری پیدا نشد." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({
      owner: {
        fullName: row.OwnerFullName == null ? null : String(row.OwnerFullName),
        mobile: row.OwnerMobile == null ? null : String(row.OwnerMobile),
        email: row.OwnerEmail == null ? null : String(row.OwnerEmail),
      },
      tenant: {
        tenantId: String(row.TenantId),
        name: String(row.Name),
        code: String(row.Code),
        status: String(row.TenantStatus),
        createdAt: row.TenantCreatedAt ?? null,
      },
      database: {
        ready: Boolean(row.DatabaseIsActive),
        name: row.DatabaseName == null ? null : String(row.DatabaseName),
        schemaVersion: row.SchemaVersion == null ? null : String(row.SchemaVersion),
      },
      provisioning: {
        status: row.JobStatus == null ? "Unknown" : String(row.JobStatus),
        attemptCount: Number(row.AttemptCount ?? 0),
        maxAttempts: Number(row.MaxAttempts ?? 0),
        lastErrorCode: row.LastErrorCode == null ? null : String(row.LastErrorCode),
        correlationId: row.CorrelationId == null ? null : String(row.CorrelationId),
        updatedAt: row.JobUpdatedAt ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "دریافت وضعیت آماده‌سازی ممکن نشد. کمی بعد دوباره تلاش کنید." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
