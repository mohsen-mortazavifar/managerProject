import sql from "mssql";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

const scrypt = promisify(scryptCallback);
const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(label) {
  const value = (await rl.question(label)).trim();
  return value;
}

async function askSecret(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("رمز عبور فقط در ترمینال تعاملی دریافت می‌شود؛ این اسکریپت را از ترمینال اجرا کنید.");
  }

  return await new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("عملیات لغو شد."));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        process.stdout.write("\\n");
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (character && !key.ctrl && !key.meta) value += character;
    };

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    // Keypress events preserve Unicode characters, including Persian passwords.
    emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", onKeypress);
  });
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const derived = await scrypt(password, salt, 64, {
    N, r, p, maxmem: 128 * N * r + 1024 * 1024,
  });
  return `$scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function main() {
  const email = (await ask("ایمیل مدیر: ")).toLowerCase();
  const fullName = await ask("نام کامل مدیر: ");
  rl.close();
  const password = await askSecret("رمز عبور (حداقل ۱۲ کاراکتر؛ هنگام تایپ نمایش داده نمی‌شود): ");
  const confirmation = await askSecret("تکرار رمز عبور: ");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw new Error("فرمت ایمیل معتبر نیست.");
  }
  if (!fullName || fullName.length > 200) throw new Error("نام کامل الزامی است و حداکثر ۲۰۰ کاراکتر دارد.");
  if (password.length < 12 || password.length > 1024) throw new Error("رمز عبور باید حداقل ۱۲ کاراکتر داشته باشد.");
  if (password !== confirmation) throw new Error("رمزهای عبور یکسان نیستند.");

  const { DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE } = process.env;
  if (!DB_SERVER || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error("متغیرهای DB_SERVER، DB_NAME، DB_USER و DB_PASSWORD را در .env.local تنظیم کنید.");
  }
  const port = DB_PORT ? Number(DB_PORT) : 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT معتبر نیست.");

  const pool = await new sql.ConnectionPool({
    server: DB_SERVER, port, database: DB_NAME, user: DB_USER, password: DB_PASSWORD,
    connectionTimeout: 10000, requestTimeout: 15000,
    options: {
      encrypt: DB_ENCRYPT !== "false",
      trustServerCertificate: DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  }).connect();

  try {
    const existing = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT TOP (1) UserId FROM dbo.Users WHERE LOWER(Email) = @email;");
    if (existing.recordset.length) {
      throw new Error("این ایمیل از قبل در جدول Users وجود دارد؛ هیچ تغییری انجام نشد.");
    }

    const passwordHash = await hashPassword(password);
    const inserted = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .input("fullName", sql.NVarChar(200), fullName)
      .input("passwordHash", sql.NVarChar(500), passwordHash)
      .query(`
        INSERT INTO dbo.Users
          (Email, PasswordHash, FullName, IsActive, IsSystemAdmin, IsPlatformUser, LastLoginAt, CreatedAt, UpdatedAt, DeletedAt)
        OUTPUT INSERTED.UserId, INSERTED.Email, INSERTED.FullName
        VALUES
          (@email, @passwordHash, @fullName, 1, 1, 1, NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), NULL);
      `);

    const user = inserted.recordset[0];
    console.log("\nمدیر سیستم با موفقیت ایجاد شد.");
    console.log(`شناسه: ${user.UserId}`);
    console.log(`ایمیل: ${user.Email}`);
    console.log("اکنون به /login بروید و با رمز واردشده وارد شوید.");
  } finally {
    await pool.close();
  }
}

main()
  .catch((error) => {
    console.error(`\nخطا: ${error instanceof Error ? error.message : "عملیات ناموفق بود."}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
