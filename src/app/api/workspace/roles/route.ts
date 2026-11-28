import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isSystemAdmin) return NextResponse.json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, { status: 403 });

  try {
    const pool = await getSqlPool();
    const owner = await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
      SELECT TOP (1) tu.TenantId
      FROM dbo.TenantUsers tu
      JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId AND tu.IsOwner = 1 AND tu.IsActive = 1
        AND t.DeletedAt IS NULL AND t.Status = N'Active';
    `);
    if (!owner.recordset[0]) return NextResponse.json({ error: "فقط مالک کسب‌وکار می‌تواند نقش‌ها را مشاهده کند." }, { status: 403 });

    const result = await pool.request().query(`
      SELECT r.RoleId, r.Name AS RoleName, r.Description AS RoleDescription,
             p.Code AS PermissionCode, p.Name AS PermissionName, p.Description AS PermissionDescription
      FROM dbo.Roles r
      LEFT JOIN dbo.RolePermissions rp ON rp.RoleId = r.RoleId
      LEFT JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
      WHERE r.Name IN (N'TenantManager', N'TenantUser')
      ORDER BY r.Name, p.Code;
    `);
    const map = new Map<string, { roleId: string; name: string; description: string; permissions: { code: string; name: string; description: string }[] }>();
    for (const row of result.recordset) {
      const name = String(row.RoleName);
      if (!map.has(name)) map.set(name, { roleId: String(row.RoleId), name, description: String(row.RoleDescription || ""), permissions: [] });
      if (row.PermissionCode) map.get(name)!.permissions.push({
        code: String(row.PermissionCode), name: String(row.PermissionName), description: String(row.PermissionDescription || "")
      });
    }
    return NextResponse.json({ roles: [...map.values()] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "دریافت نقش‌ها و مجوزها انجام نشد. مطمئن شوید مهاجرت V4 اجرا شده است." }, { status: 503 });
  }
}
