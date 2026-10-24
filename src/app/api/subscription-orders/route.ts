import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function fail(message:string,status:number){return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}

async function getOwnerTenant(userId:string){
 const pool=await getSqlPool();
 const r=await pool.request().input("userId",sql.BigInt,userId).query(`
  SELECT TOP (1) t.TenantId,t.Name,t.Status
  FROM dbo.TenantUsers tu
  INNER JOIN dbo.Tenants t ON t.TenantId=tu.TenantId
  WHERE tu.UserId=@userId AND tu.IsOwner=1 AND tu.IsActive=1 AND t.DeletedAt IS NULL
  ORDER BY tu.JoinedAt DESC;
 `);
 return r.recordset[0] as {TenantId: string|number;Name:string;Status:string}|undefined;
}

export async function GET(request:Request){
 const auth=await requireAuth(request);if(!auth.ok)return auth.response;
 if(auth.user.isPlatformUser)return fail("این بخش مخصوص مالک کسب‌وکار است.",403);
 if(auth.user.isSystemAdmin)return fail("این صفحه برای مالک کسب‌وکار است.",403);
 try{
  const pool=await getSqlPool(),tenant=await getOwnerTenant(auth.user.userId);
  if(!tenant)return fail("برای این حساب، کسب‌وکار مالکیت‌شده‌ای پیدا نشد.",403);
  const r=await pool.request().input("tenantId",sql.BigInt,tenant.TenantId).query(`
   SELECT s.SubscriptionId,s.Status,s.StartsAt,s.EndsAt,s.PriceAtSubscription,s.CreatedAt,
          p.Name AS PlanName,p.MaxBranches,p.MaxUsers,p.MaxSmsPerMonth,
          pt.PaymentTransactionId,pt.Status AS PaymentStatus,pt.Gateway,pt.GatewayTransactionId,pt.PaidAt,pt.CreatedAt AS PaymentCreatedAt
   FROM dbo.Subscriptions s
   INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=s.SubscriptionPlanId
   LEFT JOIN dbo.PaymentTransactions pt ON pt.SubscriptionId=s.SubscriptionId
   WHERE s.TenantId=@tenantId
   ORDER BY s.CreatedAt DESC,pt.CreatedAt DESC;
  `);
  return NextResponse.json({tenant:{tenantId:String(tenant.TenantId),name:tenant.Name,status:tenant.Status},orders:r.recordset.map((x)=>({
   subscriptionId:String(x.SubscriptionId),status:String(x.Status),startsAt:x.StartsAt,endsAt:x.EndsAt,
   price:Number(x.PriceAtSubscription),createdAt:x.CreatedAt,planName:String(x.PlanName),
   maxBranches:Number(x.MaxBranches),maxUsers:Number(x.MaxUsers),maxSmsPerMonth:Number(x.MaxSmsPerMonth),
   paymentTransactionId:x.PaymentTransactionId==null?null:String(x.PaymentTransactionId),
   paymentStatus:x.PaymentStatus==null?null:String(x.PaymentStatus),gateway:x.Gateway==null?null:String(x.Gateway),
   gatewayTransactionId:x.GatewayTransactionId==null?null:String(x.GatewayTransactionId),paidAt:x.PaidAt,
  }))},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("دریافت سفارش‌ها ممکن نشد. اجرای Migration دیتابیس را بررسی کنید.",503);}
}

export async function POST(request:Request){
 const auth=await requireAuth(request);if(!auth.ok)return auth.response;
 if(auth.user.isPlatformUser)return fail("این بخش مخصوص مالک کسب‌وکار است.",403);
 if(auth.user.isSystemAdmin)return fail("مدیر سیستم نمی‌تواند از این مسیر درخواست اشتراک ثبت کند.",403);
 let body:unknown;try{body=await request.json();}catch{return fail("بدنه درخواست معتبر نیست.",400);}
 const planId=(body as {subscriptionPlanId?:unknown}|null)?.subscriptionPlanId;
 if(typeof planId!=="string"||!/^[1-9]\d{0,18}$/.test(planId))return fail("شناسه پلن معتبر نیست.",400);
 try{
  const pool=await getSqlPool(),tenant=await getOwnerTenant(auth.user.userId);
  if(!tenant)return fail("فقط مالک کسب‌وکار می‌تواند درخواست اشتراک ثبت کند.",403);
  if(tenant.Status==="Suspended")return fail("کسب‌وکار تعلیق شده است و امکان سفارش ندارد.",403);
  const result=await pool.request().input("tenantId",sql.BigInt,tenant.TenantId).input("planId",sql.BigInt,planId).input("userId",sql.BigInt,auth.user.userId).query(`
   SET XACT_ABORT ON;
   BEGIN TRANSACTION;
   DECLARE @Price DECIMAL(18,2),@DurationDays INT,@IsTrial BIT,@DiscountPercent DECIMAL(5,2),@SubscriptionId BIGINT,@PaymentTransactionId BIGINT,@TrialRequestId BIGINT,@HasActive BIT,@HasReserved BIT;
   SELECT @Price=CASE WHEN IsTrial=1 THEN 0 ELSE ROUND(Price*(1-DiscountPercent/100.0),2) END,@DurationDays=DurationDays,@IsTrial=IsTrial,@DiscountPercent=DiscountPercent FROM dbo.SubscriptionPlans WITH (UPDLOCK,HOLDLOCK)
   WHERE SubscriptionPlanId=@planId AND IsActive=1;
   IF @Price IS NULL THROW 51001,'PLAN_NOT_AVAILABLE',1;
   IF @IsTrial=0 AND @Price<=0 THROW 51007,'ZERO_PRICE_PLAN_MUST_BE_TRIAL',1;
   SELECT @HasActive=CASE WHEN EXISTS(SELECT 1 FROM dbo.Subscriptions WITH (UPDLOCK,HOLDLOCK) WHERE TenantId=@tenantId AND Status=N'Active' AND EndsAt>SYSUTCDATETIME()) THEN 1 ELSE 0 END;
   SELECT @HasReserved=CASE WHEN EXISTS(SELECT 1 FROM dbo.Subscriptions WITH (UPDLOCK,HOLDLOCK) WHERE TenantId=@tenantId AND Status=N'Reserved') THEN 1 ELSE 0 END;
   IF @HasReserved=1 THROW 51005,'RESERVED_SUBSCRIPTION_EXISTS',1;
   IF @IsTrial=1
   BEGIN
    IF EXISTS(SELECT 1 FROM dbo.TenantTrialRequests WITH (UPDLOCK,HOLDLOCK) WHERE TenantId=@tenantId)
      THROW 51006,'TRIAL_ALREADY_REQUESTED',1;
    INSERT INTO dbo.TenantTrialRequests(TenantId,SubscriptionPlanId,Status,RequestedAt)
    VALUES(@tenantId,@planId,N'Pending',SYSUTCDATETIME());
    SET @TrialRequestId=SCOPE_IDENTITY();
    INSERT INTO dbo.Subscriptions(TenantId,SubscriptionPlanId,Status,StartsAt,EndsAt,PriceAtSubscription,CreatedAt,UpdatedAt)
    VALUES(@tenantId,@planId,N'PendingApproval',SYSUTCDATETIME(),DATEADD(day,@DurationDays,SYSUTCDATETIME()),@Price,SYSUTCDATETIME(),SYSUTCDATETIME());
    SET @SubscriptionId=SCOPE_IDENTITY();
    UPDATE dbo.TenantTrialRequests SET SubscriptionId=@SubscriptionId WHERE TrialRequestId=@TrialRequestId;
    COMMIT TRANSACTION;
    SELECT @SubscriptionId AS SubscriptionId,CAST(NULL AS BIGINT) AS PaymentTransactionId,@Price AS Amount,N'PendingApproval' AS Status;
   END
   ELSE
   BEGIN
    INSERT INTO dbo.Subscriptions(TenantId,SubscriptionPlanId,Status,StartsAt,EndsAt,PriceAtSubscription,CreatedAt,UpdatedAt)
    VALUES(@tenantId,@planId,N'PendingPayment',SYSUTCDATETIME(),DATEADD(day,@DurationDays,SYSUTCDATETIME()),@Price,SYSUTCDATETIME(),SYSUTCDATETIME());
    SET @SubscriptionId=SCOPE_IDENTITY();
    INSERT INTO dbo.PaymentTransactions(TenantId,SubscriptionId,Amount,Status,Gateway,CreatedAt)
    VALUES(@tenantId,@SubscriptionId,@Price,N'Pending',N'Manual',SYSUTCDATETIME());
    SET @PaymentTransactionId=SCOPE_IDENTITY();
    COMMIT TRANSACTION;
    SELECT @SubscriptionId AS SubscriptionId,@PaymentTransactionId AS PaymentTransactionId,@Price AS Amount,N'PendingPayment' AS Status;
   END
  `);
  const row=result.recordset[0];
  return NextResponse.json({order:{subscriptionId:String(row.SubscriptionId),paymentTransactionId:row.PaymentTransactionId==null?null:String(row.PaymentTransactionId),amount:Number(row.Amount),status:String(row.Status)}},{status:201,headers:{"Cache-Control":"no-store"}});
 }catch(cause){const e=cause as {number?:number};if(e.number===51001)return fail("این پلن وجود ندارد یا برای سفارش جدید غیرفعال است.",409);if(e.number===51005)return fail("برای این کسب‌وکار از قبل یک اشتراک رزرو وجود دارد.",409);if(e.number===51006)return fail("پلن آزمایشی قبلاً برای این کسب‌وکار درخواست یا استفاده شده است.",409);if(e.number===51007)return fail("پلن صفر تومانی باید به‌عنوان پلن آزمایشی تعریف شود.",409);return fail("ثبت درخواست اشتراک انجام نشد. Migration جدید را اجرا و ساختار دیتابیس را بررسی کنید.",503);}
}
