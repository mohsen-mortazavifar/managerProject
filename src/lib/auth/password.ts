import {
  pbkdf2Sync,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifies hashes created by this app ($scrypt$...) and ASP.NET Core Identity
 * V2/V3 password hashes. Unknown formats fail closed.
 */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!password || !encodedHash || encodedHash.length > 500) return false;

  try {
    if (encodedHash.startsWith("$scrypt$")) {
      const parts = encodedHash.split("$");
      if (parts.length !== 7 || parts[1] !== "scrypt") return false;

      const N = Number(parts[2]);
      const r = Number(parts[3]);
      const p = Number(parts[4]);
      const salt = decodeBase64Url(parts[5]);
      const expected = decodeBase64Url(parts[6]);

      if (
        !Number.isInteger(N) || N < 16384 || N > 262144 || (N & (N - 1)) !== 0 ||
        !Number.isInteger(r) || r < 1 || r > 16 ||
        !Number.isInteger(p) || p < 1 || p > 4 ||
        salt.length < 16 || salt.length > 64 ||
        expected.length < 32 || expected.length > 64
      ) return false;

      const actual = (await scrypt(password, salt, expected.length, {
        N, r, p, maxmem: 128 * N * r + 1024 * 1024,
      })) as Buffer;
      return safeEqual(actual, expected);
    }

    const decoded = Buffer.from(encodedHash, "base64");
    if (decoded.length < 1) return false;

    // ASP.NET Core Identity V3: marker, PRF, iteration count, salt length, salt, subkey.
    if (decoded[0] === 0x01 && decoded.length >= 14) {
      const prf = decoded.readUInt32BE(1);
      const iterations = decoded.readUInt32BE(5);
      const saltLength = decoded.readUInt32BE(9);
      if (![0, 1, 2].includes(prf) || iterations < 1 || iterations > 2_000_000) return false;
      if (saltLength < 16 || saltLength > 128 || 13 + saltLength >= decoded.length) return false;

      const digest = prf === 0 ? "sha1" : prf === 1 ? "sha256" : "sha512";
      const salt = decoded.subarray(13, 13 + saltLength);
      const expected = decoded.subarray(13 + saltLength);
      if (expected.length < 16 || expected.length > 128) return false;
      const actual = pbkdf2Sync(password, salt, iterations, expected.length, digest);
      return safeEqual(actual, expected);
    }

    // ASP.NET Identity V2: marker, 16-byte salt, 32-byte PBKDF2-HMAC-SHA1 subkey.
    if (decoded[0] === 0x00 && decoded.length === 49) {
      const salt = decoded.subarray(1, 17);
      const expected = decoded.subarray(17);
      const actual = pbkdf2Sync(password, salt, 1000, 32, "sha1");
      return safeEqual(actual, expected);
    }
  } catch {
    return false;
  }

  return false;
}
