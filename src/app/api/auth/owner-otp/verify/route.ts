import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { createAccessToken, JWT_TTL_SECONDS } from "@/lib/auth/jwt";
import { normalizeMobile, safeCompareOtpHash } from "@/lib/auth/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "درخواست نامعتبر است." }, 400);

  const input = body as { challengeId?: unknown; mobile?: unknown; code?: unknown };
  if (typeof input.challengeId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.challengeId) ||
    typeof input.mobile !== "string" || typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) {
    return respond({ error: "کد یا اطلاعات درخواست معتبر نیست." }, 400);
  }

  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); } catch { return respond({ error: "کد یا اطلاعات درخواست معتبر نیست." }, 400); }

  try {
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
   
    await tx.begin();
     console.log(",,,,,,,,")
    try {
      const found = await new sql.Request(tx)
        .input("challengeId", sql.UniqueIdentifier, input.challengeId)
        .input("mobile", sql.NVarChar(40), mobile)
        .query(`
          SELECT TOP (1) ChallengeId, Mobile, Purpose, FullName, BusinessName, OtpHash,
                 ExpiresAt, Attempts, MaxAttempts, ConsumedAt
          FROM dbo.OwnerOtpChallenges WITH (UPDLOCK, ROWLOCK)
          WHERE ChallengeId = @challengeId AND Mobile = @mobile;
        `);
      const challenge = found.recordset[0];
      if (!challenge || challenge.ConsumedAt || new Date(challenge.ExpiresAt).getTime() <= Date.now() ||
        Number(challenge.Attempts) >= Number(challenge.MaxAttempts)) {
        await tx.rollback();
        return respond({ error: "کد معتبر نیست یا منقضی شده است." }, 400);
      }

      const matches = safeCompareOtpHash(Buffer.from(challenge.OtpHash), String(challenge.ChallengeId).toLocaleLowerCase(), input.code);

      if (!matches) {
        await new sql.Request(tx)
          .input("challengeId", sql.UniqueIdentifier, input.challengeId)
          .query("UPDATE dbo.OwnerOtpChallenges SET Attempts = Attempts + 1 WHERE ChallengeId = @challengeId;");
        await tx.commit();
        return respond({ error: "کد معتبر نیست یا منقضی شده است." }, 400);
      }

      await new sql.Request(tx)
        .input("challengeId", sql.UniqueIdentifier, input.challengeId)
        .query("UPDATE dbo.OwnerOtpChallenges SET ConsumedAt = SYSUTCDATETIME() WHERE ChallengeId = @challengeId;");

      if (challenge.Purpose === "register") {
        const fullName = String(challenge.FullName || "").trim();
        const businessName = String(challenge.BusinessName || "").trim();
        if (!fullName || !businessName) throw new Error("OTP_REGISTRATION_DATA_MISSING");

        const exists = await new sql.Request(tx)
          .input("mobile", sql.NVarChar(40), mobile)
          .query("SELECT TOP (1) UserId FROM dbo.Users WHERE Mobile = @mobile AND DeletedAt IS NULL;");
        if (exists.recordset[0]) {
          await tx.commit();
          return respond({ error: "این شماره قبلاً ثبت شده است؛ لطفاً وارد شوید." }, 409);
        }

        const userResult = await new sql.Request(tx)
          .input("mobile", sql.NVarChar(40), mobile)
          .input("fullName", sql.NVarChar(200), fullName)
          .query(`
            INSERT INTO dbo.Users
              (Email, Mobile, PasswordHash, FullName, IsActive, IsSystemAdmin, IsPlatformUser, MobileVerifiedAt, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.UserId
            VALUES (NULL, @mobile, NULL, @fullName, 1, 0, 0, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
          `);
        const userId = userResult.recordset[0]?.UserId;
        if (!userId) throw new Error("USER_INSERT_FAILED");

        const tenantCode = `T_${randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
        const databaseName = `Tenant_${tenantCode}`;
        const tenantResult = await new sql.Request(tx)
          .input("name", sql.NVarChar(200), businessName)
          .input("code", sql.NVarChar(50), tenantCode)
          .input("mobile", sql.NVarChar(40), mobile)
          .query(`
            DECLARE @InsertedTenants TABLE (TenantId BIGINT);
            INSERT INTO dbo.Tenants
              (Name, Code, Status, ContactEmail, ContactMobile, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.TenantId INTO @InsertedTenants (TenantId)
            VALUES (@name, @code, N'Pending', NULL, @mobile, SYSUTCDATETIME(), SYSUTCDATETIME());
            SELECT TenantId FROM @InsertedTenants;
          `);
        const tenantId = tenantResult.recordset[0]?.TenantId;
        if (!tenantId) throw new Error("TENANT_INSERT_FAILED");

        const member = await new sql.Request(tx)
          .input("tenantId", sql.BigInt, tenantId)
          .input("userId", sql.BigInt, userId)
          .query(`
            INSERT INTO dbo.TenantUsers (TenantId, UserId, IsOwner, IsActive)
            OUTPUT INSERTED.TenantUserId
            VALUES (@tenantId, @userId, 1, 1);
          `);
        const tenantUserId = member.recordset[0]?.TenantUserId;
        if (!tenantUserId) throw new Error("TENANT_MEMBERSHIP_INSERT_FAILED");

        const role = await new sql.Request(tx)
          .input("roleName", sql.NVarChar(200), "TenantOwner")
          .query("SELECT TOP (1) RoleId FROM dbo.Roles WHERE Name = @roleName AND IsSystemRole = 1;");
        const roleId = role.recordset[0]?.RoleId;
        if (!roleId) throw new Error("TENANT_OWNER_ROLE_MISSING");

        await new sql.Request(tx).input("tenantUserId", sql.BigInt, tenantUserId).input("roleId", sql.BigInt, roleId)
          .query("INSERT INTO dbo.UserRoles (TenantUserId, RoleId, AssignedAt) VALUES (@tenantUserId, @roleId, SYSUTCDATETIME());");

        const db = await new sql.Request(tx)
          .input("tenantId", sql.BigInt, tenantId)
          .input("databaseName", sql.NVarChar(128), databaseName)
          .input("serverName", sql.NVarChar(128), process.env.TENANT_DB_SERVER || null)
          .query(`
            INSERT INTO dbo.TenantDatabases
              (TenantId, DatabaseName, ServerName, ConnectionStringEncrypted, SchemaVersion, IsActive, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.TenantDatabaseId
            VALUES (@tenantId, @databaseName, @serverName, NULL, NULL, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
          `);
        const tenantDatabaseId = db.recordset[0]?.TenantDatabaseId;
        if (!tenantDatabaseId) throw new Error("TENANT_DATABASE_RECORD_INSERT_FAILED");

        const jobResult = await new sql.Request(tx)
          .input("tenantId", sql.BigInt, tenantId)
          .input("tenantDatabaseId", sql.BigInt, tenantDatabaseId)
          .input("jobType", sql.VarChar(40), "CreateTenantDatabase")
          .input("idempotencyKey", sql.NVarChar(120), randomUUID())
          .query(`
            INSERT INTO dbo.ProvisioningJobs
              (TenantId, TenantDatabaseId, JobType, IdempotencyKey, Status, AttemptCount, MaxAttempts, RunAfter, CreatedAt)
            OUTPUT INSERTED.JobId, INSERTED.CorrelationId
            VALUES (@tenantId, @tenantDatabaseId, @jobType, @idempotencyKey, 'Queued', 0, 5, SYSUTCDATETIME(), SYSUTCDATETIME());
          `);
        const job = jobResult.recordset[0];
        if (!job) throw new Error("PROVISIONING_JOB_INSERT_FAILED");

        await new sql.Request(tx)
          .input("tenantId", sql.BigInt, tenantId)
          .input("jobId", sql.UniqueIdentifier, job.JobId)
          .query(`
            INSERT INTO dbo.TenantProvisioningLogs
              (TenantId, JobId, Status, Step, Message, AttemptNumber, StartedAt, CreatedAt)
            VALUES (@tenantId, @jobId, N'Pending', N'Queued', N'درخواست ایجاد دیتابیس در صف قرار گرفت.', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
          `);
        const user = { userId: String(userId), email: "", fullName, isSystemAdmin: false, isPlatformUser: false };
        const accessToken = createAccessToken(user);
        await tx.commit();

        return respond({
          message: "شماره تأیید شد و ثبت‌نام انجام شد.",
          tokenType: "Bearer",
          accessToken,
          expiresIn: JWT_TTL_SECONDS,
          user,
          tenant: { tenantId: String(tenantId), status: "Pending" },
          provisioning: { jobId: String(job.JobId), correlationId: String(job.CorrelationId), status: "Queued" },
        }, 201);
      }
      if (challenge.Purpose === "login") {
        const account = await new sql.Request(tx)
          .input("mobile", sql.NVarChar(40), mobile)
          .query(`
            SELECT TOP (1) u.UserId, u.Email, u.FullName, u.IsActive, u.IsSystemAdmin, u.IsPlatformUser,
              CASE WHEN EXISTS (
                SELECT 1 FROM dbo.TenantUsers tu
                WHERE tu.UserId = u.UserId AND tu.IsOwner = 1 AND tu.IsActive = 1
              ) THEN 1 ELSE 0 END AS IsBusinessOwner
            FROM dbo.Users u WHERE u.Mobile = @mobile AND u.DeletedAt IS NULL;
          `);
        const userRow = account.recordset[0];
        if (!userRow || !Boolean(userRow.IsActive) || Boolean(userRow.IsSystemAdmin) ||
            (!Boolean(userRow.IsPlatformUser) && !Boolean(userRow.IsBusinessOwner))) {
          await tx.commit();
          return respond({ error: "همکاران باید با شماره موبایل و رمز عبور وارد شوند. اگر رمز ندارید، از مالک کسب‌وکار بخواهید آن را تعیین کند." }, 403);
        }
        const user = { userId: String(userRow.UserId), email: String(userRow.Email || ""), fullName: String(userRow.FullName), isSystemAdmin: false, isPlatformUser: Boolean(userRow.IsPlatformUser) };
        const accessToken = createAccessToken(user);
        await new sql.Request(tx).input("userId", sql.BigInt, userRow.UserId)
          .query("UPDATE dbo.Users SET MobileVerifiedAt = COALESCE(MobileVerifiedAt, SYSUTCDATETIME()), LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;");
        await tx.commit();
        return respond({ tokenType: "Bearer", accessToken, expiresIn: JWT_TTL_SECONDS, user });
      }

      throw new Error("OTP_PURPOSE_INVALID");
    } catch (error) {
      try { await tx.rollback(); } catch { /* transaction may already be complete */ }
      throw error;
    }
  } catch {

    return respond({ error: "تأیید کد فعلاً در دسترس نیست." }, 503);
  }
}
