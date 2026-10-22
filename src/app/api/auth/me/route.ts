import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  return NextResponse.json({ user: result.user }, {
    headers: { "Cache-Control": "no-store" },
  });
}
