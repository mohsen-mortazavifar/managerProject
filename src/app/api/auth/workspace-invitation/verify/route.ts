import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSqlPool, sql } from "@/lib/db";
import { normalizeMobile, safeCompareOtpHash } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { getTenantSecurityRoles, syncTenantSecurityUser } from "@/lib/tenant-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "درخواست نامعتبر است." }, 400);
  const input = body as { token?: unknown; challengeId?: unknown; mobile?: unknown; code?: unknown };
  if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(input.token) ||
      typeof input.challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.challengeId) ||
      typeof input.mobile !== "string" || typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) {
    return json({ error: "کد یا اطلاعات درخواست معتبر نیست." }, 400);
  }
  let mobile: string;
  try { mobile = normalizeMobile(input.mobile); } catch { return json({ error: "کد یا اطلاعات درخواست معتبر نیست." }, 400); }
  try {
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const result = await new sql.Request(tx)
        .input("challengeId", sql.UniqueIdentifier, input.challengeId)
        .input("tokenHash", sql.VarBinary(32), digest(input.token))
        .input("mobile", sql.NVarChar(40), mobile)
        .query(`
          SELECT c.ChallengeId, c.InvitationId, c.Mobile, c.FullName, c.OtpHash, c.ExpiresAt, c.Attempts, c.MaxAttempts, c.ConsumedAt,
                 i.TenantId, i.RoleName
          FROM dbo.WorkspaceInviteOtpChallenges c WITH (UPDLOCK, ROWLOCK)
          JOIN dbo.WorkspaceInvitations i WITH (UPDLOCK, ROWLOCK) ON i.InvitationId = c.InvitationId
          WHERE c.ChallengeId = @challengeId AND c.Mobile = @mobile AND i.TokenHash = @tokenHash
            AND i.AcceptedAt IS NULL AND i.RevokedAt IS NULL AND i.ExpiresAt > SYSUTCDATETIME();
        `);
      const row = result.recordset[0];
      if (!row || row.ConsumedAt || new Date(row.ExpiresAt).getTime() <= Date.now() || Number(row.Attempts) >= Number(row.MaxAttempts)) {
        await tx.rollback(); return json({ error: "کد یا دعوت‌نامه معتبر نیست یا منقضی شده است." }, 400);
      }
      const matches = safeCompareOtpHash(Buffer.from(row.OtpHash), String(row.ChallengeId).toLowerCase(), input.code);
      if (!matches) {
        await new sql.Request(tx).input("challengeId", sql.UniqueIdentifier, input.challengeId)
          .query("UPDATE dbo.WorkspaceInviteOtpChallenges SET Attempts = Attempts + 1 WHERE ChallengeId = @challengeId;");
        await tx.commit(); return json({ error: "کد معتبر نیست یا منقضی شده است." }, 400);
      }
      await new sql.Request(tx).input("challengeId", sql.UniqueIdentifier, input.challengeId)
        .query("UPDATE dbo.WorkspaceInviteOtpChallenges SET ConsumedAt = SYSUTCDATETIME() WHERE ChallengeId = @challengeId;");

      let userResult = await new sql.Request(tx).input("mobile", sql.NVarChar(40), mobile)
        .query("SELECT TOP (1) UserId, IsActive, DeletedAt, PasswordHash, FullName, Mobile FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE Mobile = @mobile;");
      let user = userResult.recordset[0];
      if (user && (user.DeletedAt || !Boolean(user.IsActive))) {
        await tx.rollback(); return json({ error: "حساب این شماره غیرفعال است؛ با مدیر سیستم تماس بگیرید." }, 403);
      }
      if (!user) {
        userResult = await new sql.Request(tx).input("mobile", sql.NVarChar(40), mobile)
          .input("fullName", sql.NVarChar(200), String(row.FullName).trim())
          .query(`
            INSERT INTO dbo.Users (Email, Mobile, PasswordHash, FullName, IsActive, IsSystemAdmin, MobileVerifiedAt, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.UserId
            VALUES (NULL, @mobile, NULL, @fullName, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
          `);
        user = userResult.recordset[0];
      } else {
        await new sql.Request(tx).input("userId", sql.BigInt, user.UserId)
          .query("UPDATE dbo.Users SET MobileVerifiedAt = COALESCE(MobileVerifiedAt, SYSUTCDATETIME()), UpdatedAt = SYSUTCDATETIME() WHERE UserId = @userId;");
      }

      const membershipResult = await new sql.Request(tx).input("tenantId", sql.BigInt, row.TenantId)
        .input("userId", sql.BigInt, user.UserId)
        .query(`
          SELECT TOP (1) TenantUserId, IsActive FROM dbo.TenantUsers WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND UserId = @userId;
        `);
      let tenantUserId: string;
      if (membershipResult.recordset[0]) {
        const existing = membershipResult.recordset[0];
        if (Boolean(existing.IsActive)) {
          await tx.rollback(); return json({ error: "این حساب از قبل عضو این کسب‌وکار است." }, 409);
        }
        await new sql.Request(tx).input("tenantUserId", sql.BigInt, existing.TenantUserId)
          .query("UPDATE dbo.TenantUsers SET IsActive = 1 WHERE TenantUserId = @tenantUserId AND IsOwner = 0;");
        tenantUserId = String(existing.TenantUserId);
      } else {
        const membership = await new sql.Request(tx).input("tenantId", sql.BigInt, row.TenantId)
          .input("userId", sql.BigInt, user.UserId)
          .query(`
            INSERT INTO dbo.TenantUsers (TenantId, UserId, IsOwner, IsActive, JoinedAt)
            OUTPUT INSERTED.TenantUserId
            VALUES (@tenantId, @userId, 0, 1, SYSUTCDATETIME());
          `);
        tenantUserId = String(membership.recordset[0].TenantUserId);
      }
      const tenantRoles = await getTenantSecurityRoles(row.TenantId);
      const selectedRole = tenantRoles.find((role) => role.name === String(row.RoleName));
      if (!selectedRole) throw new Error("INVITATION_ROLE_MISSING");

      const masterRoleName = selectedRole.name === "Administrator" ? "TenantManager" : "TenantUser";
      const role = await new sql.Request(tx).input("roleName", sql.NVarChar(200), masterRoleName)
        .query("SELECT TOP (1) RoleId FROM dbo.Roles WHERE Name = @roleName AND IsSystemRole = 1;");
      const masterRoleId = role.recordset[0]?.RoleId;
      if (!masterRoleId) throw new Error("MASTER_MEMBERSHIP_ROLE_MISSING");
      await new sql.Request(tx).input("tenantUserId", sql.BigInt, tenantUserId).input("roleId", sql.BigInt, masterRoleId)
        .query(`
          DELETE FROM dbo.UserRoles WHERE TenantUserId = @tenantUserId;
          INSERT INTO dbo.UserRoles (TenantUserId, RoleId, AssignedAt) VALUES (@tenantUserId, @roleId, SYSUTCDATETIME());
        `);

      const tenantPasswordHash = String(user.PasswordHash || "") || await hashPassword(randomUUID());
      await syncTenantSecurityUser({
        tenantId: row.TenantId,
        masterUserId: user.UserId,
        userName: mobile,
        displayName: String(row.FullName || mobile),
        passwordHash: tenantPasswordHash,
        roleId: selectedRole.roleId,
        isActive: true,
      });

      await new sql.Request(tx).input("invitationId", sql.UniqueIdentifier, row.InvitationId)
        .query("UPDATE dbo.WorkspaceInvitations SET AcceptedAt = SYSUTCDATETIME() WHERE InvitationId = @invitationId AND AcceptedAt IS NULL AND RevokedAt IS NULL;");
      await tx.commit();
      return json({ message: "شماره تأیید شد و عضویت شما ثبت شد. اکنون از صفحه ورود مالک/کاربر وارد شوید." });
    } catch (error) {
      try { await tx.rollback(); } catch { /* transaction may already be complete */ }
      throw error;
    }
  } catch { return json({ error: "تأیید کد فعلاً در دسترس نیست." }, 503); }
}
