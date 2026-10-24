import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireSystemPermission } from "@/lib/auth/system-permissions";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 const auth=await requireSystemPermission(request,"system.users.manage");if(!auth.ok)return auth.response;
 try{const pool=await getSqlPool();const result=await pool.request().query(`SELECT u.UserId,u.FullName,u.Email,u.Mobile,u.IsActive,u.IsSystemAdmin,STRING_AGG(r.Code,N',') RoleCodes,STRING_AGG(r.Name,N'، ') RoleNames FROM dbo.Users u LEFT JOIN dbo.SystemUserRoles ur ON ur.UserId=u.UserId LEFT JOIN dbo.SystemRoles r ON r.SystemRoleId=ur.SystemRoleId AND r.IsActive=1 WHERE u.DeletedAt IS NULL GROUP BY u.UserId,u.FullName,u.Email,u.Mobile,u.IsActive,u.IsSystemAdmin ORDER BY u.IsSystemAdmin DESC,u.FullName;`);
 return NextResponse.json({users:result.recordset.map(u=>({userId:String(u.UserId),fullName:String(u.FullName),email:u.Email==null?"":String(u.Email),mobile:u.Mobile==null?"":String(u.Mobile),isActive:Boolean(u.IsActive),isSystemAdmin:Boolean(u.IsSystemAdmin),roles:u.RoleCodes?String(u.RoleCodes).split(","):[],roleNames:u.RoleNames==null?"":String(u.RoleNames)}))},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"دریافت کاربران پنل انجام نشد."},{status:503})}
}
export async function PATCH(request:Request){
 const auth=await requireSystemPermission(request,"system.users.manage");if(!auth.ok)return auth.response;
 let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"بدنه درخواست معتبر نیست."},{status:400})}
 if(!body||typeof body!=="object")return NextResponse.json({error:"بدنه درخواست معتبر نیست."},{status:400});
 const x=body as {userId?:unknown;roleCodes?:unknown;isActive?:unknown};const userId=typeof x.userId==="string"?x.userId:"";
 if(!/^[1-9]\d{0,18}$/.test(userId))return NextResponse.json({error:"شناسه کاربر معتبر نیست."},{status:400});
 if(x.isActive!==undefined&&typeof x.isActive!=="boolean")return NextResponse.json({error:"وضعیت کاربر معتبر نیست."},{status:400});
 if(x.roleCodes!==undefined&&(!Array.isArray(x.roleCodes)||x.roleCodes.some(v=>typeof v!=="string"||v.length>80)||x.roleCodes.length>20))return NextResponse.json({error:"نقش‌های انتخاب‌شده معتبر نیستند."},{status:400});
 const roleCodes=x.roleCodes===undefined?null:[...new Set(x.roleCodes as string[])];
 try{
  const pool=await getSqlPool();const existing=await pool.request().input("userId",sql.BigInt,userId).query(`SELECT UserId,IsSystemAdmin FROM dbo.Users WHERE UserId=@userId AND DeletedAt IS NULL;`);
  if(!existing.recordset[0])return NextResponse.json({error:"کاربر پیدا نشد."},{status:404});
  if(Boolean(existing.recordset[0].IsSystemAdmin))return NextResponse.json({error:"حساب مدیر کل از این صفحه قابل تغییر نیست."},{status:400});
  const tx=await pool.transaction();try{await tx.begin();
   if(x.isActive!==undefined)await tx.request().input("userId",sql.BigInt,userId).input("isActive",sql.Bit,x.isActive).query(`UPDATE dbo.Users SET IsActive=@isActive WHERE UserId=@userId;`);
   if(roleCodes!==null){
    await tx.request().input("userId",sql.BigInt,userId).query(`DELETE FROM dbo.SystemUserRoles WHERE UserId=@userId;`);
    for(const code of roleCodes)await tx.request().input("userId",sql.BigInt,userId).input("code",sql.NVarChar(80),code).input("assignedBy",sql.BigInt,auth.user.userId).query(`IF NOT EXISTS(SELECT 1 FROM dbo.SystemRoles WHERE Code=@code AND IsActive=1 AND Code<>N'SYSTEM_ADMIN') THROW 50003,'Invalid system role.',1; INSERT dbo.SystemUserRoles(UserId,SystemRoleId,AssignedByUserId) SELECT @userId,SystemRoleId,@assignedBy FROM dbo.SystemRoles WHERE Code=@code AND IsActive=1;`);
   }
   await tx.commit();
  }catch(e){await tx.rollback().catch(()=>undefined);throw e}
  return NextResponse.json({message:"کاربر پنل به‌روزرسانی شد."},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"ذخیره تغییرات کاربر انجام نشد."},{status:503})}
}
