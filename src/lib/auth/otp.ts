import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sendSms } from "@/lib/sms/sendSMS";

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
  let mobile = value.trim().replace(/[\s()\-]/g, "");

  if (/^09\d{9}$/.test(mobile)) {
    mobile = `+98${mobile.slice(1)}`;
  } else if (/^989\d{9}$/.test(mobile)) {
    mobile = `+${mobile}`;
  }

  if (!/^\+989\d{9}$/.test(mobile)) {
    throw new Error("INVALID_MOBILE");
  }

  return mobile;
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
  const result = await sendSms(mobile, `کد تأیید شما: ${otp}`);
  if (!result.success) {
    throw new Error(`SMS_PROVIDER_REQUEST_FAILED: ${result.message} (code: ${result.code})`);
  }
}
