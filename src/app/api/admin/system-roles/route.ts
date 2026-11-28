import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemRoleManagement } from "@/lib/auth/system-permissions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 const auth=await requireSystemRoleManagement(request);if(!auth.ok)return auth.response;
 try{
  const pool=await getSqlPool();
  const [roles,permissions,links]=await Promise.all([
   pool.request().query(`SELECT r.SystemRoleId,r.Code,r.Name,r.Description,r.IsActive,r.IsSystemRole,COUNT(DISTINCT ur.UserId) UserCount FROM dbo.SystemRoles r LEFT JOIN dbo.SystemUserRoles ur ON ur.SystemRoleId=r.SystemRoleId GROUP BY r.SystemRoleId,r.Code,r.Name,r.Description,r.IsActive,r.IsSystemRole ORDER BY CASE r.Code WHEN N'SYSTEM_ADMIN' THEN 0 WHEN N'TECHNICAL_MANAGER' THEN 1 WHEN N'CUSTOMER_SUCCESS' THEN 2 WHEN N'SUPPORT_AGENT' THEN 3 ELSE 4 END,r.Name;`),
   pool.request().query(`SELECT SystemPermissionId,Code,Name,Description,Category FROM dbo.SystemPermissions WHERE IsActive=1 ORDER BY Category,Code;`),
   pool.request().query(`SELECT rp.SystemRoleId,p.Code FROM dbo.SystemRolePermissions rp JOIN dbo.SystemPermissions p ON p.SystemPermissionId=rp.SystemPermissionId WHERE p.IsActive=1;`)
  ]);
  const map=new Map<string,string[]>();for(const x of links.recordset){const k=String(x.SystemRoleId);map.set(k,[...(map.get(k)||[]),String(x.Code)])}
  return NextResponse.json({roles:roles.recordset.map(r=>({id:String(r.SystemRoleId),code:String(r.Code),name:String(r.Name),description:r.Description==null?"":String(r.Description),isActive:Boolean(r.IsActive),isSystemRole:Boolean(r.IsSystemRole),userCount:Number(r.UserCount),permissions:map.get(String(r.SystemRoleId))||[]})),permissions:permissions.recordset.map(p=>({id:String(p.SystemPermissionId),code:String(p.Code),name:String(p.Name),description:p.Description==null?"":String(p.Description),category:String(p.Category)}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"دریافت نقش‌ها انجام نشد. ابتدا مهاجرت V5_SystemAdminRbac.sql را اجرا کنید."},{status:503})}
}
export async function PATCH(request:Request){
 const auth=await requireSystemRoleManagement(request);if(!auth.ok)return auth.response;
 let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"بدنه درخواست معتبر نیست."},{status:400})}
 if(!body||typeof body!=="object")return NextResponse.json({error:"بدنه درخواست معتبر نیست."},{status:400});
 const input=body as {roleId?:unknown;permissionCodes?:unknown};const roleId=typeof input.roleId==="string"?input.roleId:"";
 if(!/^[1-9]\d{0,18}$/.test(roleId)||!Array.isArray(input.permissionCodes)||input.permissionCodes.some(x=>typeof x!=="string"||x.length>150)||input.permissionCodes.length>100)return NextResponse.json({error:"نقش یا مجوزها معتبر نیستند."},{status:400});
 const codes=[...new Set(input.permissionCodes as string[])];
 try{
  const pool=await getSqlPool();const role=await pool.request().input("roleId",sql.BigInt,roleId).query(`SELECT Code FROM dbo.SystemRoles WHERE SystemRoleId=@roleId AND IsActive=1;`);
  if(!role.recordset[0])return NextResponse.json({error:"نقش پیدا نشد."},{status:404});
  if(String(role.recordset[0].Code)==="SYSTEM_ADMIN")return NextResponse.json({error:"مجوزهای مدیر کل قابل محدودکردن از این صفحه نیست."},{status:400});
  const transaction=await pool.transaction();try{await transaction.begin();
   await transaction.request().input("roleId",sql.BigInt,roleId).query(`DELETE FROM dbo.SystemRolePermissions WHERE SystemRoleId=@roleId;`);
   for(const code of codes)await transaction.request().input("roleId",sql.BigInt,roleId).input("code",sql.NVarChar(150),code).query(`IF NOT EXISTS(SELECT 1 FROM dbo.SystemPermissions WHERE Code=@code AND IsActive=1) THROW 50002,'Invalid permission code.',1; INSERT dbo.SystemRolePermissions(SystemRoleId,SystemPermissionId) SELECT @roleId,SystemPermissionId FROM dbo.SystemPermissions WHERE Code=@code AND IsActive=1;`);
   await transaction.commit();
  }catch(e){await transaction.rollback().catch(()=>undefined);throw e}
  return NextResponse.json({message:"مجوزهای نقش ذخیره شد."},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"ذخیره مجوزهای نقش انجام نشد."},{status:503})}
}
