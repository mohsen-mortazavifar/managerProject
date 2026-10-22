import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_ISSUER = "repair-master";
const JWT_AUDIENCE = "repair-master-api";
export const JWT_TTL_SECONDS = 15 * 60;

export type JwtUser = {
  userId: string;
  email: string;
  fullName: string;
  isSystemAdmin: boolean;
};

type JwtPayload = JwtUser & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 bytes.");
  }
  return secret;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

export function createAccessToken(user: JwtUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload: JwtPayload = {
    ...user,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const body = `${header}.${encode(payload)}`;
  return `${body}.${sign(body, getSecret()).toString("base64url")}`;
}

export function verifyAccessToken(token: string): JwtUser | null {
  if (!token || token.length > 4096) return null;

  try {
    const secret = getSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;

    const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<JwtPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== JWT_ISSUER ||
      payload.aud !== JWT_AUDIENCE ||
      typeof payload.sub === "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.exp <= now ||
      payload.iat > now + 60 ||
      payload.exp - payload.iat > JWT_TTL_SECONDS ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.fullName !== "string" ||
      typeof payload.isSystemAdmin !== "boolean"
    ) return null;

    return {
      userId: payload.userId,
      email: payload.email,
      fullName: payload.fullName,
      isSystemAdmin: payload.isSystemAdmin,
    };
  } catch {
    return null;
  }
}

export function getBearerUser(request: Request): JwtUser | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
  if (!match) return null;

  return verifyAccessToken(match[1]);
}
