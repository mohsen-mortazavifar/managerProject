import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const auth=await requireAuth(request);if(!auth.ok)return auth.response;
 try{
  const pool=await getSqlPool();
  const owner=await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
   SELECT TOP(1) t.TenantId,t.Status FROM dbo.TenantUsers tu
   INNER JOIN dbo.Tenants t ON t.TenantId=tu.TenantId
   WHERE tu.UserId=@userId AND tu.IsOwner=1 AND tu.IsActive=1 AND t.DeletedAt IS NULL
   ORDER BY tu.JoinedAt DESC;
  `);
  if(!owner.recordset[0])return NextResponse.json({error:"حساب مالک کسب‌وکار پیدا نشد."},{status:403});
  const result=await pool.request().query(`
   SELECT SubscriptionPlanId,Name,Description,Price,DurationDays,MaxBranches,MaxUsers,MaxSmsPerMonth
   FROM dbo.SubscriptionPlans WHERE IsActive=1 ORDER BY Price,SubscriptionPlanId;
  `);
  return NextResponse.json({plans:result.recordset.map(p=>({subscriptionPlanId:String(p.SubscriptionPlanId),name:String(p.Name),description:p.Description==null?"":String(p.Description),price:Number(p.Price),durationDays:Number(p.DurationDays),maxBranches:Number(p.MaxBranches),maxUsers:Number(p.MaxUsers),maxSmsPerMonth:Number(p.MaxSmsPerMonth)}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"دریافت پلن‌های قابل سفارش ممکن نشد."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
