import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "نیاز به ورود دارید." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json({ user }, {
    headers: { "Cache-Control": "no-store" },
  });
}
