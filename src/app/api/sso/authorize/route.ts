import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";
import { getSsoConfig } from "@/lib/auth/sso-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isSystemAdmin) return json({ error: "ورود SSO مخصوص اعضای کسب‌وکار است." }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const state = (body as { state?: unknown }).state;
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    return json({ error: "پارامتر state معتبر نیست." }, 400);
  }

  let config;
  try { config = getSsoConfig(); } catch {
    return json({ error: "تنظیمات ورود یکپارچه کامل نیست." }, 503);
  }

  try {
    const pool = await getSqlPool();
    const membership = await pool.request()
      .input("userId", sql.BigInt, auth.user.userId)
      .query(`
        SELECT TOP (1) tu.TenantId, t.Name, t.Code, t.Status
        FROM dbo.TenantUsers tu
        INNER JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
        WHERE tu.UserId = @userId AND tu.IsActive = 1
          AND t.DeletedAt IS NULL AND t.Status = N'Active'
        ORDER BY tu.IsOwner DESC, t.CreatedAt DESC;
      `);
    const tenant = membership.recordset[0];
    if (!tenant) return json({ error: "عضویت فعال در کسب‌وکاری ندارید." }, 403);

    const code = randomBytes(32).toString("base64url");
    await pool.request()
      .input("codeHash", sql.VarBinary(32), digest(code))
      .input("stateHash", sql.VarBinary(32), digest(state))
      .input("userId", sql.BigInt, auth.user.userId)
      .input("tenantId", sql.BigInt, tenant.TenantId)
      .query(`
        INSERT INTO dbo.SsoAuthorizationCodes (CodeHash, StateHash, UserId, TenantId, ExpiresAt)
        VALUES (@codeHash, @stateHash, @userId, @tenantId, DATEADD(second, 60, SYSUTCDATETIME()));
      `);

    const callback = new URL(config.businessAppCallbackUrl.toString());
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    return json({ authorizationUrl: callback.toString(), expiresIn: 60 });
  } catch {
    return json({ error: "صدور کد ورود موقتاً ممکن نیست." }, 503);
  }
}
