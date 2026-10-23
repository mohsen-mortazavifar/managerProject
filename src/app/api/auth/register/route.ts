import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getLoginClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^[+0-9()\-\s]{7,20}$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("بدنه درخواست معتبر نیست.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("بدنه درخواست معتبر نیست.", 400);
  }

  const input = body as {
    fullName?: unknown;
    email?: unknown;
    mobile?: unknown;
    password?: unknown;
    businessName?: unknown;
  };

  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const mobile = typeof input.mobile === "string" ? input.mobile.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const businessName = typeof input.businessName === "string" ? input.businessName.trim() : "";

  if (!fullName || fullName.length > 200) {
    return errorResponse("نام کامل الزامی است و حداکثر ۲۰۰ کاراکتر دارد.", 400);
  }
  if (!email || email.length > 255 || !emailPattern.test(email)) {
    return errorResponse("ایمیل معتبر نیست.", 400);
  }
  if (mobile && !mobilePattern.test(mobile)) {
    return errorResponse("شماره همراه معتبر نیست.", 400);
  }
  if (password.length < 12 || password.length > 1024) {
    return errorResponse("رمز عبور باید حداقل ۱۲ و حداکثر ۱۰۲۴ کاراکتر باشد.", 400);
  }
  if (!businessName || businessName.length > 200) {
    return errorResponse("نام کسب‌وکار الزامی است و حداکثر ۲۰۰ کاراکتر دارد.", 400);
  }

  const clientIp = getLoginClientIp(request);
  const emailHash = digest(email);
  const ipHash = clientIp ? digest(clientIp) : null;

  try {
    const pool = await getSqlPool();

    // This table is created by docs/sql/create-auth-registration-attempts.sql.
    const rateLimit = await pool.request()
      .input("emailHash", sql.VarBinary(32), emailHash)
      .input("ipHash", sql.VarBinary(32), ipHash)
      .query(`
        SELECT
          (SELECT COUNT_BIG(*)
           FROM dbo.AuthRegistrationAttempts
           WHERE EmailHash = @emailHash
             AND CreatedAt >= DATEADD(hour, -1, SYSUTCDATETIME())) AS EmailAttempts,
          (SELECT COUNT_BIG(*)
           FROM dbo.AuthRegistrationAttempts
           WHERE @ipHash IS NOT NULL AND IpHash = @ipHash
             AND CreatedAt >= DATEADD(hour, -1, SYSUTCDATETIME())) AS IpAttempts;
      `);

    if (
      Number(rateLimit.recordset[0]?.EmailAttempts ?? 0) >= 5 ||
      Number(rateLimit.recordset[0]?.IpAttempts ?? 0) >= 20
    ) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های ثبت‌نام بیش از حد مجاز است. یک ساعت دیگر تلاش کنید." },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "3600" },
        },
      );
    }

    await pool.request()
      .input("emailHash", sql.VarBinary(32), emailHash)
      .input("ipHash", sql.VarBinary(32), ipHash)
      .query(`
        INSERT INTO dbo.AuthRegistrationAttempts (EmailHash, IpHash)
        VALUES (@emailHash, @ipHash);
      `);

    const passwordHash = await hashPassword(password);
    const tenantCode = `T_${randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
    const databaseName = `Tenant_${tenantCode}`;
    const idempotencyKey = randomUUID();

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const userResult = await new sql.Request(transaction)
        .input("email", sql.NVarChar(255), email)
        .input("mobile", sql.NVarChar(20), mobile || null)
        .input("passwordHash", sql.NVarChar(500), passwordHash)
        .input("fullName", sql.NVarChar(200), fullName)
        .query(`
          INSERT INTO dbo.Users
            (Email, Mobile, PasswordHash, FullName, IsActive, IsSystemAdmin, CreatedAt, UpdatedAt)
          OUTPUT INSERTED.UserId
          VALUES (@email, @mobile, @passwordHash, @fullName, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);
      const userId = userResult.recordset[0]?.UserId;
      if (!userId) throw new Error("USER_INSERT_FAILED");

      const tenantResult = await new sql.Request(transaction)
        .input("name", sql.NVarChar(200), businessName)
        .input("code", sql.NVarChar(50), tenantCode)
        .input("contactEmail", sql.NVarChar(255), email)
        .input("contactMobile", sql.NVarChar(20), mobile || null)
        .query(`
          INSERT INTO dbo.Tenants
            (Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt)
          OUTPUT INSERTED.TenantId
          VALUES (@name, @code, N'Pending', @contactEmail, @contactMobile, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);
      const tenantId = tenantResult.recordset[0]?.TenantId;
      if (!tenantId) throw new Error("TENANT_INSERT_FAILED");

      const membershipResult = await new sql.Request(transaction)
        .input("tenantId", sql.BigInt, tenantId)
        .input("userId", sql.BigInt, userId)
        .query(`
          INSERT INTO dbo.TenantUsers (TenantId, UserId, IsOwner, IsActive)
          OUTPUT INSERTED.TenantUserId
          VALUES (@tenantId, @userId, 1, 1);
        `);
      const tenantUserId = membershipResult.recordset[0]?.TenantUserId;
      if (!tenantUserId) throw new Error("TENANT_MEMBERSHIP_INSERT_FAILED");

      const roleResult = await new sql.Request(transaction)
        .input("roleName", sql.NVarChar(200), "TenantOwner")
        .query("SELECT TOP (1) RoleId FROM dbo.Roles WHERE Name = @roleName AND IsSystemRole = 1;");
      const roleId = roleResult.recordset[0]?.RoleId;
      if (!roleId) throw new Error("TENANT_OWNER_ROLE_MISSING");

      await new sql.Request(transaction)
        .input("tenantUserId", sql.BigInt, tenantUserId)
        .input("roleId", sql.BigInt, roleId)
        .query(`
          INSERT INTO dbo.UserRoles (TenantUserId, RoleId, AssignedAt)
          VALUES (@tenantUserId, @roleId, SYSUTCDATETIME());
        `);

      const databaseResult = await new sql.Request(transaction)
        .input("tenantId", sql.BigInt, tenantId)
        .input("databaseName", sql.NVarChar(128), databaseName)
        .input("serverName", sql.NVarChar(128), process.env.TENANT_DB_SERVER || null)
        .query(`
          INSERT INTO dbo.TenantDatabases
            (TenantId, DatabaseName, ServerName, ConnectionStringEncrypted, SchemaVersion, IsActive, CreatedAt, UpdatedAt)
          OUTPUT INSERTED.TenantDatabaseId
          VALUES (@tenantId, @databaseName, @serverName, NULL, NULL, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);
      const tenantDatabaseId = databaseResult.recordset[0]?.TenantDatabaseId;
      if (!tenantDatabaseId) throw new Error("TENANT_DATABASE_RECORD_INSERT_FAILED");

      const jobResult = await new sql.Request(transaction)
        .input("tenantId", sql.BigInt, tenantId)
        .input("tenantDatabaseId", sql.BigInt, tenantDatabaseId)
        .input("jobType", sql.VarChar(40), "CreateTenantDatabase")
        .input("idempotencyKey", sql.NVarChar(120), idempotencyKey)
        .query(`
          INSERT INTO dbo.ProvisioningJobs
            (TenantId, TenantDatabaseId, JobType, IdempotencyKey, Status, AttemptCount, MaxAttempts, RunAfter, CreatedAt)
          OUTPUT INSERTED.JobId, INSERTED.CorrelationId
          VALUES (@tenantId, @tenantDatabaseId, @jobType, @idempotencyKey, 'Queued', 0, 5, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);
      const job = jobResult.recordset[0];
      if (!job) throw new Error("PROVISIONING_JOB_INSERT_FAILED");

      await new sql.Request(transaction)
        .input("tenantId", sql.BigInt, tenantId)
        .input("jobId", sql.UniqueIdentifier, job.JobId)
        .query(`
          INSERT INTO dbo.TenantProvisioningLogs
            (TenantId, JobId, Status, Step, Message, AttemptNumber, StartedAt, CreatedAt)
          VALUES (@tenantId, @jobId, N'Pending', N'Queued', N'درخواست ایجاد دیتابیس در صف قرار گرفت.', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
        `);

      await transaction.commit();

      return NextResponse.json(
        {
          message: "ثبت‌نام انجام شد. کسب‌وکار پس از آماده‌سازی دیتابیس فعال خواهد شد.",
          tenantId: String(tenantId),
          status: "Pending",
          provisioning: { jobId: String(job.JobId), correlationId: String(job.CorrelationId), status: "Queued" },
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.log("[register] Transaction failed:", error);
       return errorResponse(
    "Registration is temporarily unavailable.",
    503
  );
      try { await transaction.rollback(); } catch { console.log("[register] Transaction failed:", error); }

      const sqlError = error as { number?: number; message?: string };
      if (sqlError.number === 2627 || sqlError.number === 2601) {
        console.log("[register] Transaction failed:", error);
        return errorResponse("ایمیل یا شماره همراه قبلاً ثبت شده است.", 409);
      }
      if (sqlError.message === "TENANT_OWNER_ROLE_MISSING") {
        console.log("[register] Transaction failed:", error);
        return errorResponse("نقش مالک کسب‌وکار در دیتابیس تعریف نشده است.", 503);
      }
      return errorResponse("ثبت‌نام انجام نشد. ساختار دیتابیس و لاگ سرور را بررسی کنید.", 503);
    }
  } catch (error) {
    console.log("[register] Transaction failed:", error);
    return errorResponse("سرویس ثبت‌نام موقتاً در دسترس نیست. تنظیمات دیتابیس را بررسی کنید.", 503);
  }
}
