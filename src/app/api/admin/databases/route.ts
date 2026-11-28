import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemAdmin } from "@/lib/auth/guard";
export const runtime="nodejs"; export const dynamic="force-dynamic";
function fail(error:string,status:number){return NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});}
export async function GET(request:Request){
 const auth=await requireSystemAdmin(request); if(!auth.ok)return auth.response;
 const q=new URL(request.url).searchParams, search=(q.get("search")||"").trim().slice(0,100);
 try{
  const pool=await getSqlPool();
  const dbs=await pool.request().input("search",sql.NVarChar(100),`%${search}%`).query(`
   SELECT TOP(300) d.TenantDatabaseId,d.TenantId,t.Name AS TenantName,t.Code AS TenantCode,
    d.DatabaseName,d.ServerName,d.SchemaVersion,d.IsActive,d.CreatedAt,d.UpdatedAt
   FROM dbo.TenantDatabases d INNER JOIN dbo.Tenants t ON t.TenantId=d.TenantId
   WHERE (@search='%%' OR t.Name LIKE @search OR t.Code LIKE @search OR d.DatabaseName LIKE @search)
   ORDER BY d.CreatedAt DESC,d.TenantDatabaseId DESC;`);
  const logs=await pool.request().query(`
   SELECT TOP(100) l.ProvisioningLogId,l.TenantId,t.Name AS TenantName,l.Status,l.Step,l.Message,l.AttemptNumber,l.StartedAt,l.CompletedAt,l.CreatedAt
   FROM dbo.TenantProvisioningLogs l LEFT JOIN dbo.Tenants t ON t.TenantId=l.TenantId
   ORDER BY l.CreatedAt DESC,l.ProvisioningLogId DESC;`);
  return NextResponse.json({databases:dbs.recordset.map(r=>({tenantDatabaseId:String(r.TenantDatabaseId),tenantId:String(r.TenantId),tenantName:String(r.TenantName),tenantCode:String(r.TenantCode),databaseName:String(r.DatabaseName),serverName:r.ServerName==null?"":String(r.ServerName),schemaVersion:r.SchemaVersion==null?"":String(r.SchemaVersion),isActive:Boolean(r.IsActive),createdAt:r.CreatedAt,updatedAt:r.UpdatedAt})),provisioningLogs:logs.recordset.map(r=>({provisioningLogId:String(r.ProvisioningLogId),tenantId:String(r.TenantId),tenantName:r.TenantName==null?"":String(r.TenantName),status:String(r.Status),step:r.Step==null?"":String(r.Step),message:r.Message==null?"":String(r.Message),attemptNumber:Number(r.AttemptNumber??0),startedAt:r.StartedAt,completedAt:r.CompletedAt,createdAt:r.CreatedAt}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("اطلاعات دیتابیس‌ها در دسترس نیست. وجود جداول TenantDatabases و TenantProvisioningLogs را بررسی کنید.",503);}
}
