import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request){
 const auth=await requireSystemAdmin(request);if(!auth.ok)return auth.response;
 const q=new URL(request.url).searchParams,search=(q.get("search")||"").trim().slice(0,100);
 try{
  const pool=await getSqlPool();
  const r=await pool.request().input("search",sql.NVarChar(100),`%${search}%`).query(`
   SELECT TOP(1000) h.PriceHistoryId,h.SubscriptionPlanId,p.Name AS PlanName,h.BasePrice,h.DiscountPercent,h.EffectivePrice,h.ValidFrom,h.ValidTo,h.ChangeReason,h.CreatedAt
   FROM dbo.SubscriptionPlanPriceHistory h INNER JOIN dbo.SubscriptionPlans p ON p.SubscriptionPlanId=h.SubscriptionPlanId
   WHERE (@search='%%' OR p.Name LIKE @search)
   ORDER BY h.ValidFrom DESC,h.PriceHistoryId DESC;`);
  return NextResponse.json({history:r.recordset.map(x=>({priceHistoryId:String(x.PriceHistoryId),subscriptionPlanId:String(x.SubscriptionPlanId),planName:String(x.PlanName),basePrice:Number(x.BasePrice),discountPercent:Number(x.DiscountPercent),effectivePrice:Number(x.EffectivePrice),validFrom:x.ValidFrom,validTo:x.ValidTo,changeReason:x.ChangeReason==null?"":String(x.ChangeReason),createdAt:x.CreatedAt}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"تاریخچه قیمت در دسترس نیست. Migration تاریخچه قیمت و رویدادها را اجرا کنید."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
