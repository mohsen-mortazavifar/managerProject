import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const value = process.env.TENANT_CONNECTION_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("TENANT_CONNECTION_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters.");
  }
  return Buffer.from(value, "hex");
}

/** Format: v1.<base64url IV>.<base64url auth tag>.<base64url ciphertext>. */
export function encryptTenantConnectionString(plaintext: string): string {
  if (!plaintext.trim()) throw new Error("Cannot encrypt an empty tenant connection string.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTenantConnectionString(encrypted: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Unsupported tenant connection ciphertext format.");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Invalid tenant connection ciphertext.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
