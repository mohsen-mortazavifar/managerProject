import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function fail(message:string,status:number){return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}

export async function GET(request:Request){
 const auth=await requireSystemAdmin(request);if(!auth.ok)return auth.response;
 const params=new URL(request.url).searchParams,status=params.get("status");
 try{
  const pool=await getSqlPool();
  const r=await pool.request().input("status",sql.NVarChar(30),status==="Pending"||status==="Paid"||status==="Failed"||status==="Refunded"?status:null).query(`
   SELECT TOP (500) pt.PaymentTransactionId,pt.TenantId,t.Name AS TenantName,s.SubscriptionId,s.Status AS SubscriptionStatus,
    p.Name AS PlanName,pt.Amount,pt.Status,pt.Gateway,pt.GatewayTransactionId,pt.PaidAt,pt.CreatedAt
   FROM dbo.PaymentTransactions pt
   INNER JOIN dbo.Tenants t ON t.TenantId=pt.TenantId
   INNER JOIN dbo.Subscriptions s ON s.SubscriptionId=pt.SubscriptionId
   INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=s.SubscriptionPlanId
   WHERE (@status IS NULL OR pt.Status=@status)
   ORDER BY CASE WHEN pt.Status=N'Pending' THEN 0 ELSE 1 END,pt.CreatedAt DESC;
  `);
  return NextResponse.json({payments:r.recordset.map(x=>({paymentTransactionId:String(x.PaymentTransactionId),tenantId:String(x.TenantId),tenantName:String(x.TenantName),subscriptionId:String(x.SubscriptionId),subscriptionStatus:String(x.SubscriptionStatus),planName:String(x.PlanName),amount:Number(x.Amount),status:String(x.Status),gateway:String(x.Gateway),gatewayTransactionId:x.GatewayTransactionId==null?"":String(x.GatewayTransactionId),paidAt:x.PaidAt,createdAt:x.CreatedAt}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("دریافت پرداخت‌ها ممکن نشد.",503);}
}

export async function PATCH(request:Request){
 const auth=await requireSystemAdmin(request);if(!auth.ok)return auth.response;
 let body:unknown;try{body=await request.json();}catch{return fail("بدنه درخواست معتبر نیست.",400);}
 const input=body as {paymentTransactionId?:unknown;status?:unknown;gatewayTransactionId?:unknown}|null;
 if(!input||typeof input.paymentTransactionId!=="string"||!/^[1-9]\d{0,18}$/.test(input.paymentTransactionId))return fail("شناسه پرداخت معتبر نیست.",400);
 if(input.status!=="Paid"&&input.status!=="Failed"&&input.status!=="Refunded")return fail("وضعیت پرداخت معتبر نیست.",400);
 const gatewayTransactionId=typeof input.gatewayTransactionId==="string"?input.gatewayTransactionId.trim():"";
 if(gatewayTransactionId.length>200)return fail("شناسه تراکنش حداکثر ۲۰۰ کاراکتر است.",400);
 try{
  const pool=await getSqlPool();
  const r=await pool.request().input("paymentId",sql.BigInt,input.paymentTransactionId).input("status",sql.NVarChar(30),input.status).input("gatewayTransactionId",sql.NVarChar(200),gatewayTransactionId||null).query(`
   SET XACT_ABORT ON;
   BEGIN TRANSACTION;
   DECLARE @CurrentStatus NVARCHAR(30),@SubscriptionId BIGINT,@DurationDays INT,@PlanId BIGINT,@TenantId BIGINT,@StartsAt DATETIME2(3);
   SELECT @CurrentStatus=pt.Status,@SubscriptionId=pt.SubscriptionId,@TenantId=pt.TenantId,@PlanId=s.SubscriptionPlanId
   FROM dbo.PaymentTransactions pt WITH (UPDLOCK,HOLDLOCK)
   INNER JOIN dbo.Subscriptions s ON s.SubscriptionId=pt.SubscriptionId
   WHERE pt.PaymentTransactionId=@paymentId;
   IF @CurrentStatus IS NULL THROW 51002,'PAYMENT_NOT_FOUND',1;
   IF @CurrentStatus<>N'Pending' THROW 51003,'PAYMENT_NOT_PENDING',1;
   IF @status=N'Paid'
   BEGIN
    SELECT @DurationDays=DurationDays FROM dbo.SubscriptionPlans WHERE SubscriptionPlanId=@PlanId;
    SELECT @StartsAt=CASE WHEN MAX(EndsAt)>SYSUTCDATETIME() THEN MAX(EndsAt) ELSE SYSUTCDATETIME() END
    FROM dbo.Subscriptions WHERE TenantId=@TenantId AND SubscriptionId<>@SubscriptionId AND Status=N'Active' AND EndsAt>SYSUTCDATETIME();
    SET @StartsAt=COALESCE(@StartsAt,SYSUTCDATETIME());
    UPDATE dbo.Subscriptions SET Status=N'Active',StartsAt=@StartsAt,EndsAt=DATEADD(day,@DurationDays,@StartsAt),UpdatedAt=SYSUTCDATETIME()
    WHERE SubscriptionId=@SubscriptionId;
   END
   ELSE IF @status=N'Failed'
    UPDATE dbo.Subscriptions SET Status=N'Cancelled',UpdatedAt=SYSUTCDATETIME() WHERE SubscriptionId=@SubscriptionId;
   ELSE
    THROW 51004,'REFUND_REQUIRES_PAID_TRANSACTION',1;
   UPDATE dbo.PaymentTransactions SET Status=@status,GatewayTransactionId=COALESCE(@gatewayTransactionId,GatewayTransactionId),PaidAt=CASE WHEN @status=N'Paid' THEN SYSUTCDATETIME() ELSE PaidAt END
   WHERE PaymentTransactionId=@paymentId;
   COMMIT TRANSACTION;
   SELECT @TenantId AS TenantId,@SubscriptionId AS SubscriptionId,@status AS Status;
  `);
  return NextResponse.json({payment:{tenantId:String(r.recordset[0].TenantId),subscriptionId:String(r.recordset[0].SubscriptionId),status:String(r.recordset[0].Status)}},{headers:{"Cache-Control":"no-store"}});
 }catch(cause){const e=cause as {number?:number};if(e.number===51002)return fail("پرداخت پیدا نشد.",404);if(e.number===51003)return fail("فقط پرداخت در انتظار بررسی قابل تغییر است.",409);if(e.number===51004)return fail("برای بازپرداخت، ابتدا باید تراکنش پرداخت‌شده و گردش مالی تعریف شود.",409);return fail("به‌روزرسانی وضعیت پرداخت انجام نشد.",503);}
}
