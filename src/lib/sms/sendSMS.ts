import type { SendSmsResult, SmsStatus, SmsSendPayload } from "./types";

const baseUrl = process.env.BaseUrl?.trim();
const sendPath = process.env.SendPath?.trim();

if (!baseUrl || !sendPath) {
    throw new Error("BaseUrl and SendPath must be defined.");
}

const API_URL = `${baseUrl.replace(/\/+$/, "")}/${sendPath.replace(/^\/+/, "")}`;

const SMS_ERROR_MAP = new Map<number, string>([
  [-9994, "API Key پارس‌گرین نامعتبر است."],
  [-9995, "IP سرور در فهرست مجاز پارس‌گرین نیست."],
  [-9996, "اعتبار حساب پارس‌گرین کافی نیست."],
  [-9997, "شماره فرستنده پارس‌گرین مجاز نیست."],
  [-9998, "شماره گیرنده نامعتبر است."],
  [-9999, "خطای داخلی پارس‌گرین."],
  [0, "عملیات با موفقیت انجام شد."],
]);

function getConfiguration() {
  const apiKey = process.env.ApiKey?.trim();
  const smsNumber = process.env.SMS_NUMBER?.trim();

  if (!apiKey) {
    throw new Error("متغیر PARSPACK_SMS_API_KEY تنظیم نشده است.");
  }
  if (!smsNumber) {
    throw new Error("متغیر PARSPACK_SMS_NUMBER تنظیم نشده است.");
  }

  return { apiKey, smsNumber };
}

function validateMobile(mobile: string): void {
  const normalized = mobile.replace(/[\s()-]/g, "");
  if (!/^(?:\+98|0098|98|0)?9\d{9}$/.test(normalized)) {
    throw new Error("شماره موبایل مقصد معتبر نیست.");
  }
}

function mapErrorCode(code: number, fallback?: string): string {
  return SMS_ERROR_MAP.get(code) ?? fallback ?? `خطای نامشخص پارس‌گرین (${code}).`;
}

export async function sendSms(mobile: string, smsBody: string): Promise<SendSmsResult> {
  if (typeof mobile !== "string" || !mobile.trim()) {
    throw new Error("شماره موبایل مقصد الزامی است.");
  }
  validateMobile(mobile);

  if (typeof smsBody !== "string" || !smsBody.trim()) {
    throw new Error("متن پیامک نمی‌تواند خالی باشد.");
  }
  if (smsBody.length > 1000) {
    throw new Error("متن پیامک بیشتر از حد مجاز (۱۰۰۰ کاراکتر) است.");
  }

  const { apiKey, smsNumber } = getConfiguration();
  const payload: SmsSendPayload = {
    SmsBody: smsBody,
    Mobiles: [mobile],
    SmsNumber: smsNumber,
  };

  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `basic apikey:${apiKey}`,
  });

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await response.text();
    let parsed: SmsStatus;
    try {
      parsed = JSON.parse(responseText) as SmsStatus;
    } catch {
      return {
        success: false,
        code: response.status,
        message: "پاسخ دریافتی از سرویس پارس‌گرین معتبر نیست.",
      };
    }

    if (!response.ok || parsed.R_Success !== true) {
      return {
        success: false,
        code: typeof parsed.R_Code === "number" ? parsed.R_Code : response.status,
        message: mapErrorCode(parsed.R_Code, parsed.R_Message),
        raw: parsed,
      };
    }

    const firstData = parsed.DataList?.[0];
    return {
      success: true,
      code: typeof parsed.R_Code === "number" ? parsed.R_Code : 200,
      message: parsed.R_Message || "پیامک با موفقیت ارسال شد.",
      data: {
        messageId: firstData?.MessageId,
        cost: firstData?.Cost,
        successCount: parsed.SuccessCount,
      },
      raw: parsed,
    };
  } catch (error) {
    return {
      success: false,
      code: 0,
      message: error instanceof Error
        ? `خطای ارتباط با سرویس پارس‌گرین: ${error.message}`
        : "خطای ناشناخته در ارتباط با سرویس پیامک.",
    };
  }
}
