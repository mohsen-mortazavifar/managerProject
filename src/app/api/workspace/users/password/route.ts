import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { getTenantSecurityUserRoleId, syncTenantSecurityUser } from "@/lib/tenant-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isPlatformUser) return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);

  const input = body as { tenantUserId?: unknown; password?: unknown; confirmPassword?: unknown };
  if (typeof input.tenantUserId !== "string" || !/^\d+$/.test(input.tenantUserId) ||
      typeof input.password !== "string" || typeof input.confirmPassword !== "string") {
    return json({ error: "اطلاعات تعیین رمز عبور معتبر نیست." }, 400);
  }
  if (input.password.length < 12 || input.password.length > 1024) {
    return json({ error: "رمز عبور باید حداقل ۱۲ و حداکثر ۱۰۲۴ نویسه باشد." }, 400);
  }
  if (input.password !== input.confirmPassword) return json({ error: "تکرار رمز عبور مطابقت ندارد." }, 400);

  try {
    const pool = await getSqlPool();
    const ownerResult = await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
      SELECT TOP (1) tu.TenantId
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId AND tu.IsOwner = 1 AND tu.IsActive = 1
        AND t.DeletedAt IS NULL AND t.Status = N'Active'
      ORDER BY t.CreatedAt DESC;
    `);
    const tenant = ownerResult.recordset[0];
    if (!tenant) return json({ error: "این عملیات فقط برای مالک کسب‌وکار مجاز است." }, 403);

    const memberResult = await pool.request()
      .input("tenantId", sql.BigInt, tenant.TenantId)
      .input("tenantUserId", sql.BigInt, input.tenantUserId)
      .query(`
        SELECT TOP (1) u.UserId, u.MobileVerifiedAt, u.PasswordHash, tu.IsOwner, tu.IsActive
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Users u ON u.UserId = tu.UserId
        WHERE tu.TenantId = @tenantId AND tu.TenantUserId = @tenantUserId
          AND u.DeletedAt IS NULL;
      `);
    const member = memberResult.recordset[0];
    if (!member || !Boolean(member.IsActive) || !member.MobileVerifiedAt) {
      return json({ error: "عضو فعال و تأییدشده‌ای برای این عملیات پیدا نشد." }, 404);
    }
    if (Boolean(member.IsOwner) && String(member.UserId) !== String(auth.user.userId)) {
      return json({ error: "مالک فقط می‌تواند رمز حساب خودش را تنظیم کند." }, 403);
    }
    if (member.PasswordHash) {
      return json({ error: "این کاربر از قبل رمز عبور دارد؛ برای جلوگیری از تغییر رمز حساب مشترک، رمز فعلی بازنویسی نمی‌شود." }, 409);
    }

    const passwordHash = await hashPassword(input.password);
    const update = await pool.request()
      .input("userId", sql.BigInt, member.UserId)
      .input("passwordHash", sql.NVarChar(500), passwordHash)
      .query(`
        UPDATE dbo.Users
        SET PasswordHash = @passwordHash, UpdatedAt = SYSUTCDATETIME()
        WHERE UserId = @userId AND PasswordHash IS NULL AND MobileVerifiedAt IS NOT NULL AND DeletedAt IS NULL;
        SELECT @@ROWCOUNT AS UpdatedCount;
      `);
    if (Number(update.recordset[0]?.UpdatedCount ?? 0) !== 1) {
      return json({ error: "رمز عبور هم‌زمان تغییر کرده است؛ فهرست اعضا را تازه‌سازی کنید." }, 409);
    }

    const tenantRoleId = await getTenantSecurityUserRoleId(tenant.TenantId, member.UserId);
    if (tenantRoleId) {
      await syncTenantSecurityUser({
        tenantId: tenant.TenantId,
        masterUserId: member.UserId,
        userName: String(member.Mobile || member.UserId),
        displayName: String(member.UserId),
        passwordHash,
        roleId: tenantRoleId,
        isActive: true,
      });
    }
    return json({ message: "رمز عبور ثبت شد. آن را به‌صورت امن در اختیار صاحب حساب قرار دهید." });
  } catch {
    return json({ error: "تعیین رمز عبور انجام نشد." }, 503);
  }
}
