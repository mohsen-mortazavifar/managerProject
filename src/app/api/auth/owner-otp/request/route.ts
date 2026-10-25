import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { generateOtp, hashOtp, normalizeMobile, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, sendOtpSms } from "@/lib/auth/otp";
import { getLoginClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export async function POST(request: Request) {

  let body: unknown;
  try { body = await request.json(); } catch { return response({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "درخواست نامعتبر است." }, 400);

  const input = body as { mobile?: unknown; purpose?: unknown; fullName?: unknown; businessName?: unknown };
  if (typeof input.mobile !== "string") return response({ error: "شماره موبایل معتبر نیست." }, 400);

  let mobile1: string;
  try { mobile1 = normalizeMobile(input.mobile); } catch { return response({ error: "شماره موبایل را با دقت وارد کنید؛ مانند 09121234567." }, 400); }

  const purpose = input.purpose === "login" ? "login" : input.purpose === "register" ? "register" : null;
  if (!purpose) return response({ error: "هدف درخواست نامعتبر است." }, 400);

  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const businessName = typeof input.businessName === "string" ? input.businessName.trim() : "";
  if (purpose === "register" && (!fullName || fullName.length > 200 || !businessName || businessName.length > 200)) {
    return response({ error: "نام کامل و نام کسب‌وکار الزامی است." }, 400);
  }

  try {
    const pool = await getSqlPool();
    const clientIp = getLoginClientIp(request);
    const ipHash = clientIp ? digest(clientIp) : null;



    if (purpose === "login") {
console.log(mobile1)
  const existingUser = await pool.request()
    .input("mobile", sql.NVarChar(40), mobile1)
    .query(`
      SELECT TOP (1) u.UserId, u.IsPlatformUser, u.IsSystemAdmin,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TenantUsers tu
          WHERE tu.UserId = u.UserId AND tu.IsOwner = 1 AND tu.IsActive = 1
        ) THEN 1 ELSE 0 END AS IsBusinessOwner
      FROM dbo.Users u
      WHERE u.Mobile = @mobile AND u.DeletedAt IS NULL;
    `);

  const existing = existingUser.recordset[0];

  if (!existing) {
    return response(
      { error: "این شماره موبایل در سیستم ثبت نشده است. ابتدا ثبت‌نام کنید." },
      404
    );
  }
  if (!Boolean(existing.IsPlatformUser) && !Boolean(existing.IsSystemAdmin) && !Boolean(existing.IsBusinessOwner)) {
    return response({ error: "ورود همکاران با شماره موبایل و رمز عبور انجام می‌شود. اگر رمز ندارید، از مالک کسب‌وکار بخواهید آن را تعیین کند." }, 403);
  }
}

    if (purpose === "register") {


      const existingUser = await pool.request()
        .input("mobile", sql.NVarChar(40), mobile1)
        .query(`
      SELECT TOP (1) UserId
      FROM dbo.Users
      WHERE Mobile = @mobile
        AND DeletedAt IS NULL;
    `);

      if (existingUser.recordset.length > 0) {
        return response(
          { error: "این شماره قبلاً ثبت شده است؛ لطفاً وارد شوید." },
          409
        );
      }
    }
    // Keep request responses uniform for existing and non-existing accounts.

    const limits = await pool.request().input("mobile", sql.NVarChar(40), mobile1).input("ipHash", sql.VarBinary(32), ipHash).query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.OwnerOtpChallenges
         WHERE Mobile = @mobile AND CreatedAt >= DATEADD(hour, -1, SYSUTCDATETIME())) AS MobileCount,
        (SELECT COUNT_BIG(*) FROM dbo.OwnerOtpChallenges
         WHERE @ipHash IS NOT NULL AND ClientIpHash = @ipHash
           AND CreatedAt >= DATEADD(hour, -1, SYSUTCDATETIME())) AS IpCount,
        (SELECT TOP (1) CreatedAt FROM dbo.OwnerOtpChallenges
         WHERE Mobile = @mobile ORDER BY CreatedAt DESC) AS LastCreatedAt;
    `);
    const row = limits.recordset[0];

    if (Number(row?.MobileCount ?? 0) >= 5 || Number(row?.IpCount ?? 0) >= 20 ||
      (row?.LastCreatedAt && new Date(row.LastCreatedAt).getTime() > Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000)) {
      return response({ message: "ورود با  کد نامعتبر. لطفا چند دقیقه دیگر تلاش نمائید" });
    }

    const challengeId = randomUUID().toLowerCase();
    const otp = generateOtp();
    await pool.request()
      .input("challengeId", sql.UniqueIdentifier, challengeId)
      .input("mobile", sql.NVarChar(40), mobile1)
      .input("purpose", sql.VarChar(16), purpose)
      .input("fullName", sql.NVarChar(200), purpose === "register" ? fullName : null)
      .input("businessName", sql.NVarChar(200), purpose === "register" ? businessName : null)
      .input("otpHash", sql.VarBinary(32), hashOtp(challengeId, otp))
      .input("expiresAt", sql.DateTime2, new Date(Date.now() + OTP_TTL_SECONDS * 1000))
      .input("ipHash", sql.VarBinary(32), ipHash)
      .input("maxAttempts", sql.Int, OTP_MAX_ATTEMPTS)
      .query(`
        INSERT INTO dbo.OwnerOtpChallenges
          (ChallengeId, Mobile, Purpose, FullName, BusinessName, OtpHash, ExpiresAt, MaxAttempts, ClientIpHash)
        VALUES (@challengeId, @mobile, @purpose, @fullName, @businessName, @otpHash, @expiresAt, @maxAttempts, @ipHash);
      `);

    try {
      await sendOtpSms(mobile1, otp);
    } catch {
      await pool.request().input("challengeId", sql.UniqueIdentifier, challengeId)
        .query("UPDATE dbo.OwnerOtpChallenges SET ConsumedAt = SYSUTCDATETIME() WHERE ChallengeId = @challengeId;");
      return response({ error: "ارسال پیامک فعلاً در دسترس نیست؛ تنظیمات سرویس پیامک را بررسی کنید." }, 503);
    }

    return response({ message: "اگر شماره واجد شرایط باشد، کد ارسال خواهد شد.", challengeId });
  } catch{

    return response({ error: "درخواست کد فعلاً در دسترس نیست." }, 503);
  }
}
