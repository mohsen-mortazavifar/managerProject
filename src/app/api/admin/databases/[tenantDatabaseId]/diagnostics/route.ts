import { NextResponse } from "next/server";
import sql, { type config as SqlConfig } from "mssql";
import { getSqlPool, sql as dbSql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantDatabaseId: string }> };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function tenantConfig(database: string): SqlConfig {
  const server = process.env.DB_SERVER, user = process.env.DB_USER, password = process.env.DB_PASSWORD;
  if (!server || !user || !password) throw new Error("DB_CONNECTION_NOT_CONFIGURED");
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT_INVALID");
  return {
    server, port, user, password, database,
    connectionTimeout: 10000, requestTimeout: 15000,
    pool: { min: 0, max: 1, idleTimeoutMillis: 10000 },
    options: { encrypt: process.env.DB_ENCRYPT !== "false", trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true" },
  };
}

export async function POST(request: Request, context: Context) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;
  const { tenantDatabaseId } = await context.params;
  if (!/^[1-9]\d{0,18}$/.test(tenantDatabaseId)) return json({ error: "شناسه دیتابیس معتبر نیست." }, 400);

  let masterPool: Awaited<ReturnType<typeof getSqlPool>> | null = null;
  let tenantPool: sql.ConnectionPool | null = null;
  let msdbPool: sql.ConnectionPool | null = null;
  try {
    masterPool = await getSqlPool();
    const found = await masterPool.request().input("id", dbSql.BigInt, tenantDatabaseId).query(`
      SELECT TOP(1) TenantDatabaseId,TenantId,DatabaseName,ServerName,IsActive
      FROM dbo.TenantDatabases WHERE TenantDatabaseId=@id;
    `);
    const row = found.recordset[0];
    if (!row) return json({ error: "دیتابیس پیدا نشد." }, 404);
    const databaseName = String(row.DatabaseName);
    // Only databases provisioned with the platform naming convention may be probed.
    if (!/^Tenant_T_[A-F0-9]{24}$/.test(databaseName)) return json({ error: "نام دیتابیس با الگوی امن Provisioning مطابقت ندارد." }, 409);

    const startedAt = new Date().toISOString();
    let connection: { status: string; message: string; durationMs: number };
    let schema: { status: string; actualVersion: string | null; expectedVersion: string; appliedAt: unknown; message: string };
    let backup: { status: string; type: string | null; finishedAt: unknown; ageHours: number | null; message: string };

    const tick = Date.now();
    try {
      tenantPool = await new sql.ConnectionPool(tenantConfig(databaseName)).connect();
      await tenantPool.request().query("SELECT 1 AS ok;");
      connection = { status: "Success", message: "اتصال به دیتابیس برقرار شد.", durationMs: Date.now() - tick };
      try {
        const versions = await tenantPool.request().query(`
          IF OBJECT_ID(N'dbo.__SchemaVersions',N'U') IS NULL
            SELECT CAST(NULL AS nvarchar(50)) AS Version, CAST(NULL AS datetime2) AS AppliedAt;
          ELSE
            SELECT TOP(1) Version,AppliedAt FROM dbo.__SchemaVersions ORDER BY MigrationId DESC;
        `);
        const actual = versions.recordset[0]?.Version == null ? null : String(versions.recordset[0].Version);
        const appliedAt = versions.recordset[0]?.AppliedAt ?? null;
        schema = { status: actual === "V1_InitialSchema" ? "Current" : actual ? "Outdated" : "Missing", actualVersion: actual, expectedVersion: "V1_InitialSchema", appliedAt, message: actual === "V1_InitialSchema" ? "نسخه Schema با نسخه فعلی برنامه مطابقت دارد." : actual ? "نسخه ثبت‌شده با نسخه مورد انتظار مطابقت ندارد." : "جدول یا نسخه Schema پیدا نشد." };
      } catch {
        schema = { status: "Unknown", actualVersion: null, expectedVersion: "V1_InitialSchema", appliedAt: null, message: "خواندن نسخه Schema ممکن نشد." };
      }
    } catch {
      connection = { status: "Failed", message: "اتصال به دیتابیس برقرار نشد؛ دسترسی شبکه، سرور و مجوز حساب را بررسی کنید.", durationMs: Date.now() - tick };
      schema = { status: "Unknown", actualVersion: null, expectedVersion: "V1_InitialSchema", appliedAt: null, message: "به‌دلیل شکست اتصال، نسخه Schema بررسی نشد." };
    } finally {
      if (tenantPool) { await tenantPool.close().catch(() => undefined); tenantPool = null; }
    }

    try {
      msdbPool = await new sql.ConnectionPool(tenantConfig("msdb")).connect();
      const backupResult = await msdbPool.request().input("dbName", sql.NVarChar(128), databaseName).query(`
        SELECT TOP(1) backup_finish_date,type
        FROM dbo.backupset
        WHERE database_name=@dbName AND backup_finish_date IS NOT NULL
        ORDER BY backup_finish_date DESC;
      `);
      const b = backupResult.recordset[0];
      if (!b) backup = { status: "NoBackupFound", type: null, finishedAt: null, ageHours: null, message: "در msdb سابقه پشتیبان‌گیری برای این دیتابیس پیدا نشد یا مجوز خواندن وجود ندارد." };
      else {
        const finishedAt = new Date(b.backup_finish_date);
        const ageHours = Math.max(0, Math.round((Date.now() - finishedAt.getTime()) / 360000) / 10);
        backup = { status: "Found", type: String(b.type), finishedAt, ageHours, message: "آخرین سابقه پشتیبان‌گیری خوانده شد؛ این بررسی وجود فایل قابل‌بازیابی را تضمین نمی‌کند." };
      }
    } catch {
      backup = { status: "Unknown", type: null, finishedAt: null, ageHours: null, message: "وضعیت پشتیبان‌گیری قابل خواندن نیست؛ دسترسی msdb یا تنظیمات SQL Server را بررسی کنید." };
    } finally {
      if (msdbPool) await msdbPool.close().catch(() => undefined);
    }

    return json({ tenantDatabaseId: String(row.TenantDatabaseId), tenantId: String(row.TenantId), databaseName, checkedAt: startedAt, connection, schema, backup });
  } catch {
    return json({ error: "اجرای بررسی دیتابیس ممکن نشد. تنظیمات اتصال و دسترسی حساب SQL Server را بررسی کنید." }, 503);
  }
}
