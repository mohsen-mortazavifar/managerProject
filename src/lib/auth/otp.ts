import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

function getOtpSecret(): string {
  const secret = process.env.OTP_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("OTP_SECRET must be configured with at least 32 bytes.");
  }
  return secret;
}

export function normalizeMobile(value: string): string {
  // Keep international numbers in E.164-like form. Country-specific conversion
  // should be done explicitly by the UI or a later phone-number library.
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[\s()\-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("INVALID_MOBILE");
  }
  return normalized;
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(challengeId: string, otp: string): Buffer {
  return createHmac("sha256", getOtpSecret())
    .update(challengeId, "utf8")
    .update(":", "utf8")
    .update(otp, "utf8")
    .digest();
}

export function safeCompareOtpHash(stored: Buffer, challengeId: string, otp: string): boolean {
  const expected = hashOtp(challengeId, otp);
  return stored.length === expected.length && timingSafeEqual(stored, expected);
}

export async function sendOtpSms(mobile: string, otp: string): Promise<void> {
  const endpoint = process.env.SMS_PROVIDER_URL;
  const apiKey = process.env.SMS_PROVIDER_API_KEY;

  if (endpoint) {
    if (!apiKey) throw new Error("SMS_PROVIDER_API_KEY must be configured with SMS_PROVIDER_URL.");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to: mobile, message: `Your verification code is ${otp}` }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("SMS_PROVIDER_REQUEST_FAILED");
    return;
  }

  // Development-only transport. Never expose OTPs in production logs.
  if (process.env.NODE_ENV === "development" && process.env.OTP_DEV_LOG === "true") {
    console.info("[OTP DEV ONLY]", { mobile, otp });
    return;
  }
  throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
}
