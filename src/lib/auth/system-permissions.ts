import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth, type AuthGuardResult } from "@/lib/auth/guard";
export type SystemPermissionCode = "dashboard.view"|"tenants.view"|"tenants.update"|"tenants.suspend"|"subscriptions.view"|"subscriptions.manage"|"payments.view"|"payments.manage"|"databases.view"|"databases.diagnostics"|"events.view"|"pricing.view"|"customers.followup"|"marketing.manage"|"tickets.view"|"tickets.create"|"tickets.assign"|"tickets.resolve"|"system.users.manage"|"system.roles.manage"|"system.permissions.manage";
export type SystemPermissionResult = {ok:true;user:Extract<AuthGuardResult,{ok:true}>["user"]}|{ok:false;response:NextResponse};
export async function requireSystemPermission(request:Request,permission:SystemPermissionCode):Promise<SystemPermissionResult>{
 const auth=await requireAuth(request);if(!auth.ok)return{ok:false,response:auth.response};
 if(auth.user.isSystemAdmin)return{ok:true,user:auth.user};
 try{
  const pool=await getSqlPool();
  const result=await pool.request().input("userId",sql.BigInt,auth.user.userId).input("permission",sql.NVarChar(150),permission).query(`
   SELECT TOP(1) 1 AS Allowed FROM dbo.SystemUserRoles ur
   INNER JOIN dbo.SystemRoles r ON r.SystemRoleId=ur.SystemRoleId AND r.IsActive=1
   INNER JOIN dbo.SystemRolePermissions rp ON rp.SystemRoleId=r.SystemRoleId
   INNER JOIN dbo.SystemPermissions p ON p.SystemPermissionId=rp.SystemPermissionId AND p.IsActive=1
   INNER JOIN dbo.Users u ON u.UserId=ur.UserId AND u.IsActive=1 AND u.DeletedAt IS NULL
   WHERE ur.UserId=@userId AND p.Code=@permission;`);
  if(result.recordset.length)return{ok:true,user:auth.user};
  return{ok:false,response:NextResponse.json({error:"برای این عملیات مجوز کافی ندارید.",code:"SYSTEM_PERMISSION_REQUIRED"},{status:403,headers:{"Cache-Control":"no-store"}})};
 }catch{return{ok:false,response:NextResponse.json({error:"بررسی مجوز پنل در دسترس نیست. مهاجرت V5 را بررسی کنید."},{status:503,headers:{"Cache-Control":"no-store"}})}}
}
export async function requireSystemRoleManagement(request:Request){return requireSystemPermission(request,"system.roles.manage")}
