import sql from "mssql";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createInterface, emitKeypressEvents } from "node:readline";

const scrypt = promisify(scryptCallback);
function hidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onKey = (ch, key = {}) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("Cancelled.")); return; }
      if (key.name === "return" || key.name === "enter") { process.stdout.write("\n"); cleanup(); resolve(value); return; }
      if (key.name === "backspace" || key.name === "delete") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (ch && !key.ctrl && !key.meta) value += ch;
    };
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
  });
}
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question("Email of existing system administrator: ")).trim().toLowerCase();
  rl.close();
  const password = await hidden("New password (minimum 12 characters; hidden): ");
  const confirm = await hidden("Confirm password: ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email.");
  if (password.length < 12 || password.length > 1024 || password !== confirm) throw new Error("Password length or confirmation is invalid.");
  const { DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE } = process.env;
  if (!DB_SERVER || !DB_NAME || !DB_USER || !DB_PASSWORD) throw new Error("Configure DB connection variables in .env.local.");
  const port = DB_PORT ? Number(DB_PORT) : 1433;
  const pool = await new sql.ConnectionPool({ server: DB_SERVER, port, database: DB_NAME, user: DB_USER, password: DB_PASSWORD, connectionTimeout: 10000, requestTimeout: 15000, options: { encrypt: DB_ENCRYPT !== "false", trustServerCertificate: DB_TRUST_SERVER_CERTIFICATE === "true" } }).connect();
  try {
    const user = await pool.request().input("email", sql.NVarChar(255), email).query("SELECT TOP (1) UserId FROM dbo.Users WHERE LOWER(Email) = @email AND DeletedAt IS NULL AND IsActive = 1 AND IsSystemAdmin = 1;");
    if (!user.recordset.length) throw new Error("No active system administrator found; no change made.");
    const salt = randomBytes(16), N = 16384, r = 8, p = 1;
    const derived = await scrypt(password, salt, 64, { N, r, p, maxmem: 128 * N * r + 1024 * 1024 });
    const hash = `$scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
    await pool.request().input("email", sql.NVarChar(255), email).input("hash", sql.NVarChar(500), hash).query("UPDATE dbo.Users SET PasswordHash = @hash, UpdatedAt = SYSUTCDATETIME() WHERE LOWER(Email) = @email AND DeletedAt IS NULL AND IsActive = 1 AND IsSystemAdmin = 1;");
    console.log("Password reset for the existing active system administrator. Retry /login.");
  } finally { await pool.close(); }
}
main().catch(e => { console.error("Error:", e instanceof Error ? e.message : "Failed."); process.exitCode = 1; });
