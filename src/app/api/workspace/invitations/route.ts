import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

async function ownerTenant(userId: string) {
  const pool = await getSqlPool();
  const result = await pool.request().input("userId", sql.BigInt, userId).query(`
    SELECT TOP (1) tu.TenantId
    FROM dbo.TenantUsers tu JOIN dbo.Tenants t ON t.TenantId = tu.TenantId
    WHERE tu.UserId = @userId AND tu.IsOwner = 1 AND tu.IsActive = 1
      AND t.DeletedAt IS NULL AND t.Status = N'Active'
    ORDER BY t.CreatedAt DESC;
  `);
  return result.recordset[0] ?? null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isSystemAdmin) return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  try {
    const tenant = await ownerTenant(auth.user.userId);
    if (!tenant) return json({ error: "دسترسی مالک کسب‌وکار لازم است یا کسب‌وکار هنوز فعال نشده است." }, 403);
    const pool = await getSqlPool();
    const result = await pool.request().input("tenantId", sql.BigInt, tenant.TenantId).query(`
      SELECT InvitationId, RoleName, ExpiresAt, AcceptedAt, RevokedAt, CreatedAt
      FROM dbo.WorkspaceInvitations WHERE TenantId = @tenantId
      ORDER BY CreatedAt DESC;
    `);
    return json({ invitations: result.recordset.map((r) => ({
      invitationId: String(r.InvitationId), roleName: String(r.RoleName),
      expiresAt: r.ExpiresAt, acceptedAt: r.AcceptedAt, revokedAt: r.RevokedAt, createdAt: r.CreatedAt, isExpired: new Date(r.ExpiresAt).getTime() <= Date.now()
    })) });
  } catch { return json({ error: "دریافت دعوت‌نامه‌ها انجام نشد." }, 503); }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isSystemAdmin) return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const roleName = (body as { roleName?: unknown }).roleName;
  if (typeof roleName !== "string" || !["TenantManager", "TenantUser"].includes(roleName)) {
    return json({ error: "نقش انتخاب‌شده معتبر نیست." }, 400);
  }
  try {
    const tenant = await ownerTenant(auth.user.userId);
    if (!tenant) return json({ error: "دسترسی مالک کسب‌وکار لازم است یا کسب‌وکار هنوز فعال نشده است." }, 403);
    const pool = await getSqlPool();
    const active = await pool.request().input("tenantId", sql.BigInt, tenant.TenantId).query(`
      SELECT COUNT_BIG(*) AS Total FROM dbo.WorkspaceInvitations
      WHERE TenantId = @tenantId AND AcceptedAt IS NULL AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME();
    `);
    if (Number(active.recordset[0]?.Total ?? 0) >= 20) return json({ error: "حداکثر ۲۰ دعوت‌نامه فعال مجاز است." }, 409);
    const token = randomBytes(32).toString("base64url");
    const invitationId = randomUUID();
    await pool.request()
      .input("invitationId", sql.UniqueIdentifier, invitationId)
      .input("tokenHash", sql.VarBinary(32), digest(token))
      .input("tenantId", sql.BigInt, tenant.TenantId)
      .input("roleName", sql.NVarChar(200), roleName)
      .input("createdByUserId", sql.BigInt, auth.user.userId)
      .input("expiresAt", sql.DateTime2, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      .query(`
        INSERT INTO dbo.WorkspaceInvitations
          (InvitationId, TokenHash, TenantId, RoleName, CreatedByUserId, ExpiresAt)
        VALUES (@invitationId, @tokenHash, @tenantId, @roleName, @createdByUserId, @expiresAt);
      `);
    const origin = new URL(request.url).origin;
    return json({
      message: "دعوت‌نامه ایجاد شد. لینک را فقط برای فرد موردنظر ارسال کنید.",
      invitation: { invitationId, roleName, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
      inviteUrl: `${origin}/join/${token}`
    }, 201);
  } catch { return json({ error: "ایجاد دعوت‌نامه انجام نشد." }, 503); }
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.user.isSystemAdmin) return json({ error: "این بخش مخصوص مالک کسب‌وکار است." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const id = (body as { invitationId?: unknown }).invitationId;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "شناسه دعوت‌نامه معتبر نیست." }, 400);
  try {
    const tenant = await ownerTenant(auth.user.userId);
    if (!tenant) return json({ error: "دسترسی مالک لازم است." }, 403);
    const pool = await getSqlPool();
    const result = await pool.request().input("tenantId", sql.BigInt, tenant.TenantId)
      .input("invitationId", sql.UniqueIdentifier, id)
      .query(`
        UPDATE dbo.WorkspaceInvitations SET RevokedAt = SYSUTCDATETIME()
        WHERE TenantId = @tenantId AND InvitationId = @invitationId
          AND AcceptedAt IS NULL AND RevokedAt IS NULL;
      `);
    if (!result.rowsAffected[0]) return json({ error: "دعوت‌نامه پیدا نشد یا قبلاً استفاده/لغو شده است." }, 404);
    return json({ message: "دعوت‌نامه لغو شد." });
  } catch { return json({ error: "لغو دعوت‌نامه انجام نشد." }, 503); }
}
