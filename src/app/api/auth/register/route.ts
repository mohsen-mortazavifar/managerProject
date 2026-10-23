import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prevent the old registration endpoint from creating owners without OTP verification.
export async function POST() {
  return NextResponse.json(
    { error: "ثبت‌نام مالک از مسیر کد پیامکی انجام می‌شود. ابتدا کد تأیید را درخواست کنید." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
