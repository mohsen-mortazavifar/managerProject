import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export type WorkspacePermissionCode =
  | "workspace.users.view"
  | "workspace.users.manage"
  | "workspace.roles.manage"
  | "repairs.view"
  | "repairs.create"
  | "repairs.update"
  | "repairs.delete"
  | "customers.view"
  | "customers.manage"
  | "billing.view"
  | "billing.manage"
  | "workspace.settings.manage";

export async function requireWorkspacePermission(request: Request, permissionCode: WorkspacePermissionCode) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  if (auth.user.isSystemAdmin) {
    return { ok: true as const, user: auth.user, tenantId: null as string | null, isOwner: true };
  }

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("userId", sql.BigInt, auth.user.userId)
      .input("permissionCode", sql.NVarChar(150), permissionCode)
      .query(`
        SELECT TOP (1) tu.TenantId, tu.IsOwner
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
        LEFT JOIN dbo.UserRoles ur ON ur.TenantUserId = tu.TenantUserId
        LEFT JOIN dbo.RolePermissions rp ON rp.RoleId = ur.RoleId
        LEFT JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId
        WHERE tu.UserId = @userId AND tu.IsActive = 1
          AND t.DeletedAt IS NULL AND t.Status = N'Active'
          AND (tu.IsOwner = 1 OR p.Code = @permissionCode)
        ORDER BY tu.IsOwner DESC, tu.TenantUserId DESC;
      `);
    const row = result.recordset[0];
    if (!row) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "برای این عملیات مجوز کافی ندارید." }, {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        }),
      };
    }
    return { ok: true as const, user: auth.user, tenantId: String(row.TenantId), isOwner: Boolean(row.IsOwner) };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "بررسی مجوز دسترسی در دسترس نیست." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    };
  }
}
