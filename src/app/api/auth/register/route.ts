import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Do not allow the legacy email/password registration endpoint to create owners
// without mobile verification. The verified OTP endpoint performs provisioning.
export async function POST() {
  return NextResponse.json(
    { error: "ثبت‌نام مالک از مسیر کد پیامکی انجام می‌شود. ابتدا کد تأیید را درخواست کنید." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
