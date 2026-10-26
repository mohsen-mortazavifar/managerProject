import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";
import { normalizeMobile } from "@/lib/auth/otp";
import { getTenantSecurityRoles, syncTenantSecurityUser } from "@/lib/tenant-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

async function getOwnerTenant(userId: string) {
  const pool = await getSqlPool();
  const result = await pool.request()
    .input("userId", sql.BigInt, userId)
    .query(`
      SELECT TOP (1) tu.TenantId
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId
        AND tu.IsActive = 1
        AND tu.IsOwner = 1
        AND t.DeletedAt IS NULL
        AND t.Status = N'Active'
      ORDER BY t.CreatedAt DESC;
    `);
  return result.recordset[0] ?? null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.user.isPlatformUser) {
    return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  }

  try {
    const tenant = await getOwnerTenant(auth.user.userId);
    if (!tenant) {
      return json({ error: "دسترسی مالک کسب‌وکار لازم است یا کسب‌وکار هنوز فعال نشده است." }, 403);
    }

    const pool = await getSqlPool();
    const [membersResult, tenantRoles] = await Promise.all([
      pool.request()
        .input("tenantId", sql.BigInt, tenant.TenantId)
        .query(`
          SELECT
            tu.TenantUserId,
            u.UserId,
            u.FullName,
            u.Mobile,
            u.Email,
            CASE WHEN u.PasswordHash IS NULL OR LTRIM(RTRIM(u.PasswordHash)) = N'' THEN 0 ELSE 1 END AS HasPassword,
            tu.IsOwner,
            tu.IsActive,
            tu.JoinedAt,
            STRING_AGG(r.Name, N',') AS RoleNames
          FROM dbo.TenantUsers tu
          INNER JOIN dbo.Users u ON u.UserId = tu.UserId
          LEFT JOIN dbo.UserRoles ur ON ur.TenantUserId = tu.TenantUserId
          LEFT JOIN dbo.Roles r ON r.RoleId = ur.RoleId
          WHERE tu.TenantId = @tenantId
            AND u.DeletedAt IS NULL
          GROUP BY
            tu.TenantUserId, u.UserId, u.FullName, u.Mobile,
            u.Email, u.PasswordHash, tu.IsOwner, tu.IsActive, tu.JoinedAt
          ORDER BY tu.IsOwner DESC, u.FullName;
        `),
      getTenantSecurityRoles(tenant.TenantId),
    ]);

    return json({
      members: membersResult.recordset.map((row) => ({
        tenantUserId: String(row.TenantUserId),
        userId: String(row.UserId),
        fullName: String(row.FullName),
        mobile: row.Mobile == null ? "" : String(row.Mobile),
        email: row.Email == null ? "" : String(row.Email),
        hasPassword: Boolean(row.HasPassword),
        isOwner: Boolean(row.IsOwner),
        isActive: Boolean(row.IsActive),
        joinedAt: row.JoinedAt,
        roles: row.RoleNames ? String(row.RoleNames).split(",") : [],
      })),
      roles: tenantRoles,
    });
  } catch {
    return json({ error: "دریافت فهرست کاربران ممکن نشد." }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.user.isPlatformUser) {
    return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "درخواست نامعتبر است." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "درخواست نامعتبر است." }, 400);
  }

  const input = body as { mobile?: unknown; roleId?: unknown };
  if (
    typeof input.mobile !== "string" ||
    (typeof input.roleId !== "string" && typeof input.roleId !== "number") ||
    !/^[0-9]+$/.test(String(input.roleId))
  ) {
    return json({ error: "شماره موبایل یا نقش انتخاب‌شده معتبر نیست." }, 400);
  }

  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); } catch {
    return json({ error: "شماره موبایل معتبر نیست. شماره ایران را با 09 وارد کنید." }, 400);
  }

  try {
    const tenant = await getOwnerTenant(auth.user.userId);
    if (!tenant) {
      return json({ error: "دسترسی مالک کسب‌وکار لازم است یا کسب‌وکار هنوز فعال نشده است." }, 403);
    }

    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const userResult = await new sql.Request(tx)
        .input("mobile", sql.NVarChar(40), mobile)
        .query(`
          SELECT TOP (1) UserId, IsActive, MobileVerifiedAt, PasswordHash, Mobile, FullName
          FROM dbo.Users
          WHERE Mobile = @mobile AND DeletedAt IS NULL;
        `);
      const user = userResult.recordset[0];

      if (!user || !Boolean(user.IsActive) || !user.MobileVerifiedAt) {
        await tx.rollback();
        return json({ error: "حساب فعال و تأییدشده‌ای با این شماره پیدا نشد." }, 404);
      }

      const existing = await new sql.Request(tx)
        .input("tenantId", sql.BigInt, tenant.TenantId)
        .input("userId", sql.BigInt, user.UserId)
        .query(`
          SELECT TOP (1) TenantUserId, IsActive
          FROM dbo.TenantUsers WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND UserId = @userId;
        `);

      let tenantUserId: string;
      if (existing.recordset[0]) {
        if (Boolean(existing.recordset[0].IsActive)) {
          await tx.rollback();
          return json({ error: "این کاربر از قبل عضو این کسب‌وکار است." }, 409);
        }

        await new sql.Request(tx)
          .input("tenantUserId", sql.BigInt, existing.recordset[0].TenantUserId)
          .query(`
            UPDATE dbo.TenantUsers
            SET IsActive = 1
            WHERE TenantUserId = @tenantUserId AND IsOwner = 0;
          `);
        tenantUserId = String(existing.recordset[0].TenantUserId);
      } else {
        const membership = await new sql.Request(tx)
          .input("tenantId", sql.BigInt, tenant.TenantId)
          .input("userId", sql.BigInt, user.UserId)
          .query(`
            INSERT INTO dbo.TenantUsers (TenantId, UserId, IsOwner, IsActive, JoinedAt)
            OUTPUT INSERTED.TenantUserId
            VALUES (@tenantId, @userId, 0, 1, SYSUTCDATETIME());
          `);
        tenantUserId = String(membership.recordset[0].TenantUserId);
      }

      const tenantRoles = await getTenantSecurityRoles(tenant.TenantId);
      const selectedRole = tenantRoles.find((role) => role.roleId === String(input.roleId));
      if (!selectedRole) throw new Error("ROLE_NOT_FOUND");

      // Keep the master membership role for existing workspace authorization.
      const masterRoleName = selectedRole.name === "Administrator" ? "TenantManager" : "TenantUser";
      const roleResult = await new sql.Request(tx)
        .input("roleName", sql.NVarChar(200), masterRoleName)
        .query("SELECT TOP (1) RoleId FROM dbo.Roles WHERE Name = @roleName AND IsSystemRole = 1;");
      const roleId = roleResult.recordset[0]?.RoleId;
      if (!roleId) throw new Error("ROLE_NOT_FOUND");

      await syncTenantSecurityUser({
        tenantId: tenant.TenantId,
        masterUserId: user.UserId,
        userName: String(user.Mobile || mobile),
        displayName: String(user.FullName || user.Mobile || mobile),
        passwordHash: String(user.PasswordHash || ""),
        roleId: selectedRole.roleId,
        isActive: true,
      });

      await new sql.Request(tx)
        .input("tenantUserId", sql.BigInt, tenantUserId)
        .input("roleId", sql.BigInt, roleId)
        .query(`
          DELETE FROM dbo.UserRoles
          WHERE TenantUserId = @tenantUserId;

          INSERT INTO dbo.UserRoles (TenantUserId, RoleId, AssignedAt)
          VALUES (@tenantUserId, @roleId, SYSUTCDATETIME());
        `);

      await tx.commit();
      return json({ message: "کاربر به کسب‌وکار اضافه شد." }, 201);
    } catch {
      try { await tx.rollback(); } catch { /* transaction may already have ended */ }
      throw new Error("MEMBER_ADD_FAILED");
    }
  } catch {
    return json({ error: "افزودن کاربر انجام نشد." }, 503);
  }
}


export async function PATCH(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isPlatformUser) return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const input = body as { tenantUserId?: unknown; isActive?: unknown; roleName?: unknown };
  if (typeof input.tenantUserId !== "string" || !/^\d+$/.test(input.tenantUserId)) return json({ error: "شناسه عضویت معتبر نیست." }, 400);
  const hasActiveChange = typeof input.isActive === "boolean";
  const hasRoleChange = typeof input.roleName === "string";
  if ((!hasActiveChange && !hasRoleChange) ||
      (input.isActive !== undefined && typeof input.isActive !== "boolean") ||
      (input.roleName !== undefined && (typeof input.roleName !== "string" || !["TenantManager", "TenantUser"].includes(input.roleName)))) {
    return json({ error: "وضعیت یا نقش انتخاب‌شده معتبر نیست." }, 400);
  }
  try {
    const tenant = await getOwnerTenant(auth.user.userId);
    if (!tenant) return json({ error: "این عملیات فقط برای مالک کسب‌وکار مجاز است." }, 403);
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const memberResult = await new sql.Request(tx).input("tenantId", sql.BigInt, tenant.TenantId)
        .input("tenantUserId", sql.BigInt, input.tenantUserId)
        .query(`SELECT TenantUserId, IsOwner FROM dbo.TenantUsers WITH (UPDLOCK, HOLDLOCK)
                WHERE TenantId = @tenantId AND TenantUserId = @tenantUserId;`);
      const member = memberResult.recordset[0];
      if (!member || Boolean(member.IsOwner)) {
        await tx.rollback();
        return json({ error: "عضویت پیدا نشد یا امکان تغییر مالک وجود ندارد." }, 404);
      }
      if (hasActiveChange) {
        await new sql.Request(tx).input("tenantId", sql.BigInt, tenant.TenantId)
          .input("tenantUserId", sql.BigInt, input.tenantUserId).input("isActive", sql.Bit, input.isActive)
          .query(`UPDATE dbo.TenantUsers SET IsActive = @isActive
                  WHERE TenantId = @tenantId AND TenantUserId = @tenantUserId AND IsOwner = 0;`);
      }
      if (hasRoleChange) {
        const roleResult = await new sql.Request(tx).input("roleName", sql.NVarChar(200), input.roleName)
          .query("SELECT TOP (1) RoleId FROM dbo.Roles WHERE Name = @roleName AND IsSystemRole = 1;");
        const roleId = roleResult.recordset[0]?.RoleId;
        if (!roleId) throw new Error("ROLE_NOT_FOUND");
        await new sql.Request(tx).input("tenantUserId", sql.BigInt, input.tenantUserId).input("roleId", sql.BigInt, roleId)
          .query(`DELETE FROM dbo.UserRoles WHERE TenantUserId = @tenantUserId;
                  INSERT INTO dbo.UserRoles (TenantUserId, RoleId, AssignedAt)
                  VALUES (@tenantUserId, @roleId, SYSUTCDATETIME());`);
      }
      await tx.commit();
      return json({ message: hasRoleChange ? "نقش عضو با موفقیت تغییر کرد." : input.isActive ? "عضویت فعال شد." : "عضویت غیرفعال شد." });
    } catch (error) {
      try { await tx.rollback(); } catch { /* transaction may already have ended */ }
      throw error;
    }
  } catch { return json({ error: "تغییر وضعیت یا نقش عضو انجام نشد." }, 503); }
}
