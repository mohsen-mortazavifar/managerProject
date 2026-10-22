import { NextResponse } from "next/server";
import { getBearerUser } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getBearerUser(request);
  if (!user) {
    return NextResponse.json({ error: "توکن معتبر نیست یا منقضی شده است." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json({ user }, {
    headers: { "Cache-Control": "no-store" },
  });
}
