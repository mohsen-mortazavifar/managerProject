import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { getSqlPool, sql } from "@/lib/db";

const WINDOW_MINUTES = 15;
const MAX_EMAIL_FAILURES = 8;
const MAX_IP_FAILURES = 30;

export type LoginRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function getLoginClientIp(request: Request): string | null {
  // Forwarding headers are attacker-controlled unless a trusted reverse proxy
  // overwrites them. Opt in only when the deployment guarantees that behavior.
  if (process.env.TRUST_PROXY_HEADERS !== "true") return null;

  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const value = realIp || forwardedIp || "";
  return value && value.length <= 128 && isIP(value) !== 0 ? value : null;
}

export async function checkLoginRateLimit(
  email: string,
  clientIp: string | null,
): Promise<LoginRateLimitResult> {
  const pool = await getSqlPool();
  const emailHash = digest(email);
  const ipHash = clientIp ? digest(clientIp) : null;

  const result = await pool.request()
    .input("emailHash", sql.VarBinary(32), emailHash)
    .input("ipHash", sql.VarBinary(32), ipHash)
    .query(`
      SELECT
        (SELECT COUNT_BIG(*)
         FROM dbo.AuthLoginAttempts
         WHERE EmailHash = @emailHash
           AND Succeeded = 0
           AND CreatedAt >= DATEADD(minute, -${WINDOW_MINUTES}, SYSUTCDATETIME())) AS EmailFailures,
        (SELECT COUNT_BIG(*)
         FROM dbo.AuthLoginAttempts
         WHERE @ipHash IS NOT NULL
           AND IpHash = @ipHash
           AND Succeeded = 0
           AND CreatedAt >= DATEADD(minute, -${WINDOW_MINUTES}, SYSUTCDATETIME())) AS IpFailures;
    `);

  const emailFailures = Number(result.recordset[0]?.EmailFailures ?? 0);
  const ipFailures = Number(result.recordset[0]?.IpFailures ?? 0);
  if (emailFailures >= MAX_EMAIL_FAILURES || ipFailures >= MAX_IP_FAILURES) {
    return { allowed: false, retryAfterSeconds: WINDOW_MINUTES * 60 };
  }

  return { allowed: true };
}

export async function recordLoginAttempt(
  email: string,
  clientIp: string | null,
  succeeded: boolean,
  request: Request,
): Promise<void> {
  const pool = await getSqlPool();
  const emailHash = digest(email);
  const ipHash = clientIp ? digest(clientIp) : null;
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 500) || null;

  await pool.request()
    .input("emailHash", sql.VarBinary(32), emailHash)
    .input("ipHash", sql.VarBinary(32), ipHash)
    .input("succeeded", sql.Bit, succeeded)
    .input("userAgent", sql.NVarChar(500), userAgent)
    .query(`
      INSERT INTO dbo.AuthLoginAttempts (EmailHash, IpHash, Succeeded, UserAgent)
      VALUES (@emailHash, @ipHash, @succeeded, @userAgent);
    `);
}
