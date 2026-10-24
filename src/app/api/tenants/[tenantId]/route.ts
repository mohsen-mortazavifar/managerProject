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
    const [tenantResult, usersResult, subscriptionsResult, databaseResult, paymentsResult, trialResult] = await Promise.all([
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TenantId, Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt
        FROM dbo.Tenants WHERE TenantId = @tenantId AND DeletedAt IS NULL;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT tu.TenantUserId, u.UserId, u.FullName, u.Mobile, u.Email, u.IsActive AS UserIsActive,
          tu.IsOwner, tu.IsActive AS MembershipIsActive, tu.JoinedAt,
          STRING_AGG(r.Name, N',') AS RoleNames
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Users u ON u.UserId=tu.UserId
        LEFT JOIN dbo.UserRoles ur ON ur.TenantUserId=tu.TenantUserId
        LEFT JOIN dbo.Roles r ON r.RoleId=ur.RoleId
        WHERE tu.TenantId=@tenantId AND u.DeletedAt IS NULL
        GROUP BY tu.TenantUserId,u.UserId,u.FullName,u.Mobile,u.Email,u.IsActive,tu.IsOwner,tu.IsActive,tu.JoinedAt
        ORDER BY tu.IsOwner DESC,u.FullName;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(20) s.SubscriptionId,s.Status,s.StartsAt,s.EndsAt,s.PriceAtSubscription,s.CreatedAt,
          p.Name AS PlanName,p.DurationDays
        FROM dbo.Subscriptions s INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=s.SubscriptionPlanId
        WHERE s.TenantId=@tenantId ORDER BY s.CreatedAt DESC,s.SubscriptionId DESC;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(1) TenantDatabaseId,DatabaseName,ServerName,SchemaVersion,IsActive,CreatedAt,UpdatedAt
        FROM dbo.TenantDatabases WHERE TenantId=@tenantId ORDER BY CreatedAt DESC,TenantDatabaseId DESC;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(20) PaymentTransactionId,SubscriptionId,Amount,Status,Gateway,GatewayTransactionId,PaidAt,CreatedAt
        FROM dbo.PaymentTransactions WHERE TenantId=@tenantId ORDER BY CreatedAt DESC,PaymentTransactionId DESC;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(10) r.TrialRequestId,r.Status,r.RequestedAt,r.ReviewedAt,r.ReviewNote,p.Name AS PlanName
        FROM dbo.TenantTrialRequests r INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=r.SubscriptionPlanId
        WHERE r.TenantId=@tenantId ORDER BY r.RequestedAt DESC,r.TrialRequestId DESC;
      `)
    ]);

    const row = tenantResult.recordset[0];
    if (!row) return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    const db = databaseResult.recordset[0];
    return NextResponse.json({
      tenant: {
        tenantId: String(row.TenantId), name: String(row.Name), code: String(row.Code), status: String(row.Status),
        contactEmail: row.ContactEmail == null ? "" : String(row.ContactEmail),
        contactMobile: row.ContactMobile == null ? "" : String(row.ContactMobile),
        createdAt: row.CreatedAt, updatedAt: row.UpdatedAt,
      },
      users: usersResult.recordset.map((u) => ({
        tenantUserId: String(u.TenantUserId), userId: String(u.UserId), fullName: String(u.FullName),
        mobile: u.Mobile == null ? "" : String(u.Mobile), email: u.Email == null ? "" : String(u.Email),
        userIsActive: Boolean(u.UserIsActive), isOwner: Boolean(u.IsOwner), isActive: Boolean(u.MembershipIsActive),
        joinedAt: u.JoinedAt, roles: u.RoleNames ? String(u.RoleNames).split(",") : [],
      })),
      subscriptions: subscriptionsResult.recordset.map((s) => ({
        subscriptionId: String(s.SubscriptionId), status: String(s.Status), planName: String(s.PlanName),
        startsAt: s.StartsAt, endsAt: s.EndsAt, price: Number(s.PriceAtSubscription),
        durationDays: Number(s.DurationDays), createdAt: s.CreatedAt,
      })),
      database: db ? {
        tenantDatabaseId: String(db.TenantDatabaseId), databaseName: String(db.DatabaseName),
        serverName: db.ServerName == null ? "" : String(db.ServerName),
        schemaVersion: db.SchemaVersion == null ? "" : String(db.SchemaVersion),
        isActive: Boolean(db.IsActive), createdAt: db.CreatedAt, updatedAt: db.UpdatedAt,
      } : null,
      payments: paymentsResult.recordset.map((p) => ({
        paymentTransactionId: String(p.PaymentTransactionId), subscriptionId: String(p.SubscriptionId),
        amount: Number(p.Amount), status: String(p.Status), gateway: String(p.Gateway),
        gatewayTransactionId: p.GatewayTransactionId == null ? "" : String(p.GatewayTransactionId),
        paidAt: p.PaidAt, createdAt: p.CreatedAt,
      })),
      trialRequests: trialResult.recordset.map((t) => ({
        trialRequestId: String(t.TrialRequestId), status: String(t.Status), planName: String(t.PlanName),
        requestedAt: t.RequestedAt, reviewedAt: t.ReviewedAt, reviewNote: t.ReviewNote == null ? "" : String(t.ReviewNote),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "دریافت اطلاعات کامل کسب‌وکار ممکن نشد. migrationها و جداول کاربران، اشتراک و دیتابیس را بررسی کنید." }, { status: 503 });
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
