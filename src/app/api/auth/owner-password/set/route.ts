import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isPlatformUser || auth.user.isSystemAdmin) {
    return NextResponse.json({ error: "این عملیات مخصوص حساب کسب‌وکار است." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as { password?: unknown }).password !== "string") {
    return NextResponse.json({ error: "رمز عبور معتبر نیست." }, { status: 400 });
  }
  const password = (body as { password: string }).password;
  if (password.length < 12 || password.length > 1024) {
    return NextResponse.json({ error: "رمز عبور باید حداقل ۱۲ کاراکتر باشد." }, { status: 400 });
  }

  try {
    const pool = await getSqlPool();
    const account = await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
      SELECT TOP (1) MobileVerifiedAt, IsPlatformUser, IsSystemAdmin
      FROM dbo.Users WHERE UserId = @userId AND DeletedAt IS NULL AND IsActive = 1;
    `);
    const row = account.recordset[0];
    if (!row || !row.MobileVerifiedAt || Boolean(row.IsPlatformUser) || Boolean(row.IsSystemAdmin)) {
      return NextResponse.json({ error: "برای تعیین رمز عبور ابتدا باید حساب کسب‌وکار با پیامک تأیید شود." }, { status: 403 });
    }
    const ownerMembership = await pool.request().input("userId", sql.BigInt, auth.user.userId).query(`
      SELECT TOP (1) 1 AS IsOwner
      FROM dbo.TenantUsers tu
      INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
      WHERE tu.UserId = @userId AND tu.IsOwner = 1 AND tu.IsActive = 1
        AND t.DeletedAt IS NULL AND t.Status = N'Active';
    `);
    if (!ownerMembership.recordset.length) {
      return NextResponse.json({ error: "تنظیم رمز پشتیبان فقط برای مالک فعال کسب‌وکار مجاز است." }, { status: 403 });
    }

    const passwordHash = await hashPassword(password);
    await pool.request().input("userId", sql.BigInt, auth.user.userId)
      .input("passwordHash", sql.NVarChar(500), passwordHash).query(`
        UPDATE dbo.Users
        SET PasswordHash = @passwordHash, UpdatedAt = SYSUTCDATETIME()
        WHERE UserId = @userId AND DeletedAt IS NULL AND IsActive = 1;
      `);
    return NextResponse.json({ message: "رمز عبور پشتیبان تنظیم شد." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "تنظیم رمز عبور موقتاً ممکن نیست." }, { status: 503 });
  }
}
