import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ tenantId: string }> };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, context: Context) {
  const auth = await requireSystemAdmin(request);
  if (!auth.ok) return auth.response;
  const { tenantId } = await context.params;
  if (!/^[1-9]\d{0,18}$/.test(tenantId)) return json({ error: "شناسه کسب‌وکار معتبر نیست." }, 400);

  try {
    const pool = await getSqlPool();
    const tenantResult = await pool.request().input("tenantId", sql.BigInt, tenantId).query(`
      SELECT TenantId, Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt
      FROM dbo.Tenants WHERE TenantId=@tenantId AND DeletedAt IS NULL;
    `);
    const t = tenantResult.recordset[0];
    if (!t) return json({ error: "کسب‌وکار پیدا نشد." }, 404);

    const [usersResult, subscriptionsResult, databasesResult, paymentsResult] = await Promise.all([
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT tu.TenantUserId,u.UserId,u.FullName,u.Mobile,u.Email,tu.IsOwner,tu.IsActive,tu.JoinedAt,
          STRING_AGG(r.Name,N',') AS RoleNames
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Users u ON u.UserId=tu.UserId
        LEFT JOIN dbo.UserRoles ur ON ur.TenantUserId=tu.TenantUserId
        LEFT JOIN dbo.Roles r ON r.RoleId=ur.RoleId
        WHERE tu.TenantId=@tenantId AND u.DeletedAt IS NULL
        GROUP BY tu.TenantUserId,u.UserId,u.FullName,u.Mobile,u.Email,tu.IsOwner,tu.IsActive,tu.JoinedAt
        ORDER BY tu.IsOwner DESC,u.FullName;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(10) s.SubscriptionId,s.Status,s.StartsAt,s.EndsAt,s.PriceAtSubscription,p.Name AS PlanName,p.DurationDays
        FROM dbo.Subscriptions s LEFT JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=s.SubscriptionPlanId
        WHERE s.TenantId=@tenantId ORDER BY s.CreatedAt DESC,s.SubscriptionId DESC;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT td.TenantDatabaseId,td.DatabaseName,td.ServerName,td.SchemaVersion,td.IsActive,td.CreatedAt,td.UpdatedAt,
          pj.Status AS ProvisioningStatus,pj.LastErrorCode,pj.CorrelationId,
          COALESCE(pj.CompletedAt,pj.StartedAt,pj.CreatedAt) AS ProvisioningUpdatedAt
        FROM dbo.TenantDatabases td
        LEFT JOIN dbo.ProvisioningJobs pj ON pj.TenantDatabaseId=td.TenantDatabaseId
        WHERE td.TenantId=@tenantId
        ORDER BY pj.CreatedAt DESC,td.CreatedAt DESC;
      `),
      pool.request().input("tenantId", sql.BigInt, tenantId).query(`
        SELECT TOP(10) PaymentTransactionId,SubscriptionId,Amount,Status,Gateway,GatewayTransactionId,PaidAt,CreatedAt
        FROM dbo.PaymentTransactions WHERE TenantId=@tenantId
        ORDER BY CreatedAt DESC,PaymentTransactionId DESC;
      `)
    ]);

    return json({
      tenant: { tenantId:String(t.TenantId), name:String(t.Name), code:String(t.Code), status:String(t.Status),
        contactEmail:t.ContactEmail==null?"":String(t.ContactEmail), contactMobile:t.ContactMobile==null?"":String(t.ContactMobile),
        createdAt:t.CreatedAt, updatedAt:t.UpdatedAt },
      users: usersResult.recordset.map(x=>({ tenantUserId:String(x.TenantUserId), userId:String(x.UserId),
        fullName:String(x.FullName), mobile:x.Mobile==null?"":String(x.Mobile), email:x.Email==null?"":String(x.Email),
        isOwner:Boolean(x.IsOwner), isActive:Boolean(x.IsActive), joinedAt:x.JoinedAt,
        roles:x.RoleNames?String(x.RoleNames).split(","):[] })),
      subscriptions: subscriptionsResult.recordset.map(x=>({ subscriptionId:String(x.SubscriptionId),status:String(x.Status),
        startsAt:x.StartsAt,endsAt:x.EndsAt,price:Number(x.PriceAtSubscription),planName:x.PlanName==null?"—":String(x.PlanName),
        durationDays:Number(x.DurationDays??0) })),
      databases: databasesResult.recordset.map(x=>({ tenantDatabaseId:String(x.TenantDatabaseId),
        databaseName:String(x.DatabaseName),serverName:x.ServerName==null?"":String(x.ServerName),
        schemaVersion:x.SchemaVersion==null?"":String(x.SchemaVersion),isActive:Boolean(x.IsActive),
        createdAt:x.CreatedAt,updatedAt:x.UpdatedAt,provisioningStatus:x.ProvisioningStatus==null?"Unknown":String(x.ProvisioningStatus),
        lastErrorCode:x.LastErrorCode==null?"":String(x.LastErrorCode),correlationId:x.CorrelationId==null?"":String(x.CorrelationId),
        provisioningUpdatedAt:x.ProvisioningUpdatedAt })),
      payments: paymentsResult.recordset.map(x=>({ paymentTransactionId:String(x.PaymentTransactionId),
        subscriptionId:String(x.SubscriptionId),amount:Number(x.Amount),status:String(x.Status),gateway:String(x.Gateway),
        gatewayTransactionId:x.GatewayTransactionId==null?"":String(x.GatewayTransactionId),paidAt:x.PaidAt,createdAt:x.CreatedAt }))
    });
  } catch {
    return json({ error: "دریافت جزئیات کسب‌وکار ممکن نشد. ساختار جدول‌های کاربران، اشتراک و دیتابیس را بررسی کنید." }, 503);
  }
}
