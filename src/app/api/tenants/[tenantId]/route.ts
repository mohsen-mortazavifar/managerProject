import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set(["Pending", "Active", "Suspended"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RouteContext = { params: Promise<{ tenantId: string }> };

async function parseTenantId(context: RouteContext): Promise<string | null> {
  const { tenantId } = await context.params;
  return /^[1-9]\d{0,18}$/.test(tenantId) ? tenantId : null;
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;

  const tenantId = await parseTenantId(context);
  if (!tenantId) return NextResponse.json({ error: "شناسه کسب‌وکار معتبر نیست." }, { status: 400 });

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("tenantId", sql.BigInt, tenantId)
      .query(`
        SELECT TenantId, Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt
        FROM dbo.Tenants
        WHERE TenantId = @tenantId AND DeletedAt IS NULL;
      `);
    const row = result.recordset[0];
    if (!row) return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });

    return NextResponse.json({ tenant: {
      tenantId: String(row.TenantId), name: String(row.Name), code: String(row.Code),
      status: String(row.Status), contactEmail: row.ContactEmail == null ? "" : String(row.ContactEmail),
      contactMobile: row.ContactMobile == null ? "" : String(row.ContactMobile),
      createdAt: row.CreatedAt, updatedAt: row.UpdatedAt,
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "دریافت اطلاعات کسب‌وکار ممکن نشد." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;

  const tenantId = await parseTenantId(context);
  if (!tenantId) return NextResponse.json({ error: "شناسه کسب‌وکار معتبر نیست." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست." }, { status: 400 });
  }

  const input = body as { name?: unknown; contactEmail?: unknown; contactMobile?: unknown; status?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const contactEmail = typeof input.contactEmail === "string" ? input.contactEmail.trim().toLowerCase() : "";
  const contactMobile = typeof input.contactMobile === "string" ? input.contactMobile.trim() : "";
  const status = typeof input.status === "string" ? input.status : "";

  if (!name || name.length > 200) return NextResponse.json({ error: "نام کسب‌وکار الزامی و حداکثر ۲۰۰ کاراکتر است." }, { status: 400 });
  if (contactEmail && (contactEmail.length > 255 || !emailPattern.test(contactEmail))) return NextResponse.json({ error: "ایمیل تماس معتبر نیست." }, { status: 400 });
  if (contactMobile.length > 20) return NextResponse.json({ error: "شماره همراه حداکثر ۲۰ کاراکتر است." }, { status: 400 });
  if (!statuses.has(status)) return NextResponse.json({ error: "وضعیت انتخاب‌شده معتبر نیست." }, { status: 400 });

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("tenantId", sql.BigInt, tenantId)
      .input("name", sql.NVarChar(200), name)
      .input("contactEmail", sql.NVarChar(255), contactEmail || null)
      .input("contactMobile", sql.NVarChar(20), contactMobile || null)
      .input("status", sql.NVarChar(30), status)
      .query(`
        UPDATE dbo.Tenants
        SET Name = @name, ContactEmail = @contactEmail, ContactMobile = @contactMobile,
            Status = @status, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.TenantId, INSERTED.Name, INSERTED.Code, INSERTED.Status,
               INSERTED.ContactEmail, INSERTED.ContactMobile, INSERTED.CreatedAt, INSERTED.UpdatedAt
        WHERE TenantId = @tenantId AND DeletedAt IS NULL;
      `);
    const row = result.recordset[0];
    if (!row) return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });

    return NextResponse.json({ tenant: {
      tenantId: String(row.TenantId), name: String(row.Name), code: String(row.Code),
      status: String(row.Status), contactEmail: row.ContactEmail == null ? "" : String(row.ContactEmail),
      contactMobile: row.ContactMobile == null ? "" : String(row.ContactMobile),
      createdAt: row.CreatedAt, updatedAt: row.UpdatedAt,
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ویرایش کسب‌وکار ممکن نشد." }, { status: 503 });
  }
}
