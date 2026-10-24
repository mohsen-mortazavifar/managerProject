import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request){
 const auth=await requireSystemAdmin(request); if(!auth.ok)return auth.response;
 const q=new URL(request.url).searchParams,search=(q.get("search")||"").trim().slice(0,100),severity=q.get("severity")||"all";
 try{
  const pool=await getSqlPool();
  const r=await pool.request().input("search",sql.NVarChar(100),`%${search}%`).input("severity",sql.NVarChar(20),severity).query(`
   SELECT TOP(500) EventLogId,EventType,Severity,EntityType,EntityId,Message,Details,ActorUserId,CreatedAt
   FROM dbo.SystemEventLogs
   WHERE (@search='%%' OR EventType LIKE @search OR EntityType LIKE @search OR EntityId LIKE @search OR Message LIKE @search)
    AND (@severity=N'all' OR Severity=@severity)
   ORDER BY CreatedAt DESC,EventLogId DESC;`);
  return NextResponse.json({events:r.recordset.map(x=>({eventLogId:String(x.EventLogId),eventType:String(x.EventType),severity:String(x.Severity),entityType:x.EntityType==null?"":String(x.EntityType),entityId:x.EntityId==null?"":String(x.EntityId),message:String(x.Message),details:x.Details==null?"":String(x.Details),actorUserId:x.ActorUserId==null?"":String(x.ActorUserId),createdAt:x.CreatedAt}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"گزارش رویدادها در دسترس نیست. Migration تاریخچه قیمت و رویدادها را اجرا کنید."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
