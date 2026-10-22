import { createHash, randomBytes } from "node:crypto";
import { getSqlPool, sql } from "@/lib/db";

export const SESSION_COOKIE_NAME = "repair_master_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AuthenticatedUser = {
  userId: string;
  email: string;
  fullName: string;
  isSystemAdmin: boolean;
};

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function persistSession(
  token: string,
  userId: string | number,
  request: Request,
): Promise<void> {
  const pool = await getSqlPool();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = (forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "").slice(0, 45);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 500);

  await pool.request()
    .input("userId", sql.NVarChar(128), String(userId))
    .input("tokenHash", sql.VarBinary(32), hashToken(token))
    .input("expiresAt", sql.DateTime2, expiresAt)
    .input("ipAddress", sql.NVarChar(45), ipAddress || null)
    .input("userAgent", sql.NVarChar(500), userAgent || null)
    .query(`
      INSERT INTO dbo.UserSessions
        (UserId, TokenHash, ExpiresAt, IpAddress, UserAgent)
      VALUES
        (@userId, @tokenHash, @expiresAt, @ipAddress, @userAgent);
    `);
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) return null;

  const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;

  try {
    const pool = await getSqlPool();
    const result = await pool.request()
      .input("tokenHash", sql.VarBinary(32), hashToken(token))
      .query(`
        SELECT TOP (1)
          CONVERT(nvarchar(128), u.UserId) AS UserId,
          u.Email,
          u.FullName,
          u.IsSystemAdmin
        FROM dbo.UserSessions AS s
        INNER JOIN dbo.Users AS u
          ON CONVERT(nvarchar(128), u.UserId) = s.UserId
        WHERE s.TokenHash = @tokenHash
          AND s.RevokedAt IS NULL
          AND s.ExpiresAt > SYSUTCDATETIME()
          AND u.IsActive = 1
          AND u.DeletedAt IS NULL;
      `);

    const user = result.recordset[0];
    if (!user) return null;

    return {
      userId: String(user.UserId),
      email: String(user.Email),
      fullName: String(user.FullName),
      isSystemAdmin: Boolean(user.IsSystemAdmin),
    };
  } catch {
    // Missing session table or database outage must never grant access.
    return null;
  }
}

export async function revokeSession(request: Request): Promise<void> {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) return;

  const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return;

  const pool = await getSqlPool();
  await pool.request()
    .input("tokenHash", sql.VarBinary(32), hashToken(token))
    .query(`
      UPDATE dbo.UserSessions
      SET RevokedAt = SYSUTCDATETIME()
      WHERE TokenHash = @tokenHash AND RevokedAt IS NULL;
    `);
}
