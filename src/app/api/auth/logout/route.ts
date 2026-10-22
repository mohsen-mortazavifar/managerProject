import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Access tokens are stateless. The client must discard its token on logout.
 * This endpoint does not revoke an already-issued JWT; it simply provides a
 * consistent API response for clients.
 */
export async function POST() {
  const response = NextResponse.json({ success: true, message: "توکن را از حافظه یا فضای امن کلاینت حذف کنید." });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
