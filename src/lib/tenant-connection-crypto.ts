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

export function encryptTenantConnectionPayload(plaintext: string): string {
  if (!plaintext.trim()) throw new Error("Cannot encrypt an empty tenant connection payload.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTenantConnectionPayload(encrypted: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error("Unsupported tenant credential ciphertext format.");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Invalid tenant credential ciphertext.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
