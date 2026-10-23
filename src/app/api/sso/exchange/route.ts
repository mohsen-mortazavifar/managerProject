import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

function hasValidClientSecret(request: Request): boolean {
  const expected = process.env.SSO_CLIENT_SECRET;
  const supplied = request.headers.get("x-sso-client-secret");
  if (!expected || Buffer.byteLength(expected, "utf8") < 32 || !supplied) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!hasValidClientSecret(request)) return json({ error: "اعتبار سرویس معتبر نیست." }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const input = body as { code?: unknown; state?: unknown };
  if (
    typeof input.code !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(input.code) ||
    typeof input.state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.state)
  ) return json({ error: "کد یا state معتبر نیست." }, 400);

  try {
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const found = await new sql.Request(tx)
        .input("codeHash", sql.VarBinary(32), digest(input.code))
        .input("stateHash", sql.VarBinary(32), digest(input.state))
        .query(`
          SELECT TOP (1) SsoAuthorizationCodeId, UserId, TenantId, ExpiresAt, ConsumedAt
          FROM dbo.SsoAuthorizationCodes WITH (UPDLOCK, ROWLOCK)
          WHERE CodeHash = @codeHash AND StateHash = @stateHash;
        `);
      const row = found.recordset[0];
      if (!row || row.ConsumedAt || new Date(row.ExpiresAt).getTime() <= Date.now()) {
        await tx.rollback();
        return json({ error: "کد ورود معتبر نیست یا منقضی شده است." }, 400);
      }

      const account = await new sql.Request(tx)
        .input("userId", sql.BigInt, row.UserId)
        .input("tenantId", sql.BigInt, row.TenantId)
        .query(`
          SELECT u.UserId, u.FullName, u.Mobile, u.Email,
                 tu.TenantUserId, tu.IsOwner,
                 t.TenantId, t.Name AS TenantName, t.Code AS TenantCode
          FROM dbo.Users u
          INNER JOIN dbo.TenantUsers tu ON tu.UserId = u.UserId AND tu.TenantId = @tenantId AND tu.IsActive = 1
          INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId AND t.DeletedAt IS NULL AND t.Status = N'Active'
          WHERE u.UserId = @userId AND u.IsActive = 1 AND u.DeletedAt IS NULL
            AND u.MobileVerifiedAt IS NOT NULL AND u.IsSystemAdmin = 0;
        `);
      const user = account.recordset[0];
      if (!user) {
        await tx.rollback();
        return json({ error: "حساب یا عضویت کسب‌وکار دیگر فعال نیست." }, 403);
      }

      await new sql.Request(tx)
        .input("id", sql.BigInt, row.SsoAuthorizationCodeId)
        .query("UPDATE dbo.SsoAuthorizationCodes SET ConsumedAt = SYSUTCDATETIME() WHERE SsoAuthorizationCodeId = @id AND ConsumedAt IS NULL;");
      await tx.commit();

      return json({
        user: {
          userId: String(user.UserId),
          fullName: String(user.FullName || ""),
          mobile: String(user.Mobile || ""),
          email: user.Email == null ? null : String(user.Email),
        },
        tenant: {
          tenantId: String(user.TenantId),
          name: String(user.TenantName),
          code: String(user.TenantCode),
          membershipId: String(user.TenantUserId),
          isOwner: Boolean(user.IsOwner),
        },
      });
    } catch (error) {
      try { await tx.rollback(); } catch { /* transaction may already be complete */ }
      throw error;
    }
  } catch {
    return json({ error: "تبادل کد ورود موقتاً در دسترس نیست." }, 503);
  }
}
