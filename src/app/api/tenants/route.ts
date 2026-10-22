import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const codePattern = /^[A-Za-z0-9_-]{2,50}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("search") || "").trim().slice(0, 100);

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("search", sql.NVarChar(100), `%${search}%`)
      .query(`
        SELECT TOP (200)
          TenantId, Name, Code, Status, ContactEmail, ContactMobile,
          CreatedAt, UpdatedAt
        FROM dbo.Tenants
        WHERE DeletedAt IS NULL
          AND (@search = '%%' OR Name LIKE @search OR Code LIKE @search OR ContactEmail LIKE @search)
        ORDER BY CreatedAt DESC, TenantId DESC;
      `);

    return NextResponse.json(
      { tenants: result.recordset.map((row) => ({
        tenantId: String(row.TenantId),
        name: String(row.Name),
        code: String(row.Code),
        status: String(row.Status),
        contactEmail: row.ContactEmail == null ? "" : String(row.ContactEmail),
        contactMobile: row.ContactMobile == null ? "" : String(row.ContactMobile),
        createdAt: row.CreatedAt,
        updatedAt: row.UpdatedAt,
      })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "دریافت فهرست کسب‌وکارها ممکن نشد. اتصال و ساختار دیتابیس را بررسی کنید." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست." }, { status: 400 });
  }

  const input = body as {
    name?: unknown; code?: unknown; contactEmail?: unknown; contactMobile?: unknown;
  };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const contactEmail = typeof input.contactEmail === "string" ? input.contactEmail.trim().toLowerCase() : "";
  const contactMobile = typeof input.contactMobile === "string" ? input.contactMobile.trim() : "";

  if (!name || name.length > 200) {
    return NextResponse.json({ error: "نام کسب‌وکار الزامی است و حداکثر ۲۰۰ کاراکتر دارد." }, { status: 400 });
  }
  if (!codePattern.test(code)) {
    return NextResponse.json({ error: "کد باید ۲ تا ۵۰ کاراکتر و شامل حروف انگلیسی، عدد، خط تیره یا زیرخط باشد." }, { status: 400 });
  }
  if (contactEmail && (contactEmail.length > 255 || !emailPattern.test(contactEmail))) {
    return NextResponse.json({ error: "ایمیل تماس معتبر نیست." }, { status: 400 });
  }
  if (contactMobile.length > 20) {
    return NextResponse.json({ error: "شماره همراه حداکثر ۲۰ کاراکتر می‌تواند باشد." }, { status: 400 });
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("name", sql.NVarChar(200), name)
      .input("code", sql.NVarChar(50), code)
      .input("contactEmail", sql.NVarChar(255), contactEmail || null)
      .input("contactMobile", sql.NVarChar(20), contactMobile || null)
      .query(`
        INSERT INTO dbo.Tenants (Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt)
        OUTPUT INSERTED.TenantId, INSERTED.Name, INSERTED.Code, INSERTED.Status,
               INSERTED.ContactEmail, INSERTED.ContactMobile, INSERTED.CreatedAt, INSERTED.UpdatedAt
        VALUES (@name, @code, N'Pending', @contactEmail, @contactMobile, SYSUTCDATETIME(), SYSUTCDATETIME());
      `);

    const row = result.recordset[0];
    return NextResponse.json({
      tenant: {
        tenantId: String(row.TenantId), name: String(row.Name), code: String(row.Code),
        status: String(row.Status), contactEmail: row.ContactEmail == null ? "" : String(row.ContactEmail),
        contactMobile: row.ContactMobile == null ? "" : String(row.ContactMobile),
        createdAt: row.CreatedAt, updatedAt: row.UpdatedAt,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const sqlError = error as { number?: number; code?: string };
    if (sqlError.number === 2627 || sqlError.number === 2601 || sqlError.code === "EREQUEST") {
      return NextResponse.json(
        { error: "ثبت کسب‌وکار انجام نشد؛ احتمالاً کد تکراری است یا محدودیت دیتابیس نقض شده است." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "ثبت کسب‌وکار ممکن نشد. اتصال و ساختار دیتابیس را بررسی کنید." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
