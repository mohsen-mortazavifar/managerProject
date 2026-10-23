import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { generateOtp, hashOtp, normalizeMobile, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, sendOtpSms } from "@/lib/auth/otp";
import { getLoginClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const input = body as { token?: unknown; mobile?: unknown; fullName?: unknown };
  if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(input.token) ||
      typeof input.mobile !== "string" || typeof input.fullName !== "string") return json({ error: "اطلاعات دعوت‌نامه معتبر نیست." }, 400);
  const fullName = input.fullName.trim();
  if (!fullName || fullName.length > 200) return json({ error: "نام کامل الزامی است." }, 400);
  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); } catch { return json({ error: "شماره موبایل معتبر نیست؛ مانند 09121234567." }, 400); }
  try {
    const pool = await getSqlPool();
    const invite = await pool.request().input("tokenHash", sql.VarBinary(32), digest(input.token)).query(`
      SELECT TOP (1) InvitationId, TenantId, RoleName
      FROM dbo.WorkspaceInvitations
      WHERE TokenHash = @tokenHash AND AcceptedAt IS NULL AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME();
    `);
    const invitation = invite.recordset[0];
    if (!invitation) return json({ error: "این دعوت‌نامه معتبر نیست یا منقضی شده است." }, 404);
    const clientIp = getLoginClientIp(request);
    const ipHash = clientIp ? digest(clientIp) : null;
    const limits = await pool.request().input("mobile", sql.NVarChar(40), mobile)
      .input("ipHash", sql.VarBinary(32), ipHash)
      .query(`
        SELECT
          (SELECT COUNT_BIG(*) FROM dbo.WorkspaceInviteOtpChallenges WHERE Mobile = @mobile AND CreatedAt >= DATEADD(hour,-1,SYSUTCDATETIME())) AS MobileCount,
          (SELECT COUNT_BIG(*) FROM dbo.WorkspaceInviteOtpChallenges WHERE @ipHash IS NOT NULL AND ClientIpHash = @ipHash AND CreatedAt >= DATEADD(hour,-1,SYSUTCDATETIME())) AS IpCount,
          (SELECT TOP (1) CreatedAt FROM dbo.WorkspaceInviteOtpChallenges WHERE Mobile = @mobile ORDER BY CreatedAt DESC) AS LastCreatedAt;
      `);
    const row = limits.recordset[0];
    if (Number(row?.MobileCount ?? 0) >= 5 || Number(row?.IpCount ?? 0) >= 20 ||
      (row?.LastCreatedAt && new Date(row.LastCreatedAt).getTime() > Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000)) {
      return json({ error: "برای ارسال کد باید کمی صبر کنید." }, 429);
    }
    const challengeId = randomUUID().toLowerCase();
    const otp = generateOtp();
    await pool.request()
      .input("challengeId", sql.UniqueIdentifier, challengeId)
      .input("invitationId", sql.UniqueIdentifier, invitation.InvitationId)
      .input("mobile", sql.NVarChar(40), mobile)
      .input("fullName", sql.NVarChar(200), fullName)
      .input("otpHash", sql.VarBinary(32), hashOtp(challengeId, otp))
      .input("expiresAt", sql.DateTime2, new Date(Date.now() + OTP_TTL_SECONDS * 1000))
      .input("maxAttempts", sql.Int, OTP_MAX_ATTEMPTS)
      .input("ipHash", sql.VarBinary(32), ipHash)
      .query(`
        INSERT INTO dbo.WorkspaceInviteOtpChallenges
          (ChallengeId, InvitationId, Mobile, FullName, OtpHash, ExpiresAt, MaxAttempts, ClientIpHash)
        VALUES (@challengeId, @invitationId, @mobile, @fullName, @otpHash, @expiresAt, @maxAttempts, @ipHash);
      `);
    try { await sendOtpSms(mobile, otp); }
    catch {
      await pool.request().input("challengeId", sql.UniqueIdentifier, challengeId)
        .query("UPDATE dbo.WorkspaceInviteOtpChallenges SET ConsumedAt = SYSUTCDATETIME() WHERE ChallengeId = @challengeId;");
      return json({ error: "ارسال پیامک فعلاً در دسترس نیست؛ تنظیمات سرویس پیامک را بررسی کنید." }, 503);
    }
    return json({ message: "کد تأیید ارسال شد؛ اعتبار کد ۵ دقیقه است.", challengeId });
  } catch { return json({ error: "درخواست کد فعلاً در دسترس نیست." }, 503); }
}
