import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { getBearerToken, hashAccessToken, verifyAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token || !verifyAccessToken(token)) {
    return NextResponse.json(
      { error: "توکن معتبر نیست یا منقضی شده است." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const pool = await getSqlPool();
    const tokenHash = hashAccessToken(token);
    await pool.request()
      .input("tokenHash", sql.VarBinary(32), tokenHash)
      .input("expiresAt", sql.DateTime2, new Date(Date.now() + JWT_TTL_SECONDS * 1000))
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.RevokedAccessTokens WHERE TokenHash = @tokenHash)
        BEGIN
          INSERT INTO dbo.RevokedAccessTokens (TokenHash, ExpiresAt)
          VALUES (@tokenHash, @expiresAt);
        END;
      `);

    const response = NextResponse.json({ success: true, message: "از حساب خارج شدید." });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "خروج امن موقتاً در دسترس نیست. تنظیمات دیتابیس و اسکریپت ابطال توکن را بررسی کنید." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
