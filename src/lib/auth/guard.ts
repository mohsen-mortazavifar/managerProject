import { NextResponse } from "next/server";
import { getBearerUser, type JwtUser } from "@/lib/auth/jwt";

export type AuthGuardResult =
  | { ok: true; user: JwtUser }
  | { ok: false; response: NextResponse };

export function requireAuth(request: Request): AuthGuardResult {
  const user = getBearerUser(request);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "توکن معتبر نیست یا منقضی شده است." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  return { ok: true, user };
}

export function requireSystemAdmin(request: Request): AuthGuardResult {
  const result = requireAuth(request);
  if (!result.ok) return result;

  if (!result.user.isSystemAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "برای انجام این عملیات دسترسی مدیر سیستم لازم است." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  return result;
}
