import { createDecipheriv } from "node:crypto";
import sql from "mssql";
import { getSqlPool, sql as masterSql } from "@/lib/db";

type TenantUserInput = {
  tenantId: string | number | bigint;
  masterUserId: string | number | bigint;
  userName: string;
  displayName: string;
  passwordHash: string;
  roleId: string | number | bigint;
  isActive?: boolean;
};

function decryptCredential(value: string): string {
  const keyHex = process.env.TENANT_CONNECTION_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error("TENANT_CONNECTION_ENCRYPTION_KEY_INVALID");
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("TENANT_CREDENTIAL_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

async function getTenantPool(tenantId: TenantUserInput["tenantId"]) {
  const master = await getSqlPool();
  const result = await master.request().input("tenantId", masterSql.BigInt, tenantId).query(`
    SELECT TOP (1) DatabaseName, ServerName, SqlLoginName, SqlPasswordEncrypted
    FROM dbo.TenantDatabases
    WHERE TenantId = @tenantId AND IsActive = 1
    ORDER BY TenantDatabaseId DESC;
  `);
  const row = result.recordset[0];
  if (!row || !row.DatabaseName || !row.SqlLoginName || !row.SqlPasswordEncrypted) {
    throw new Error("TENANT_DATABASE_NOT_READY");
  }
  const password = decryptCredential(String(row.SqlPasswordEncrypted));
  const port = Number(process.env.TENANT_DB_PORT || process.env.DB_PORT || 1433);
  const pool = new sql.ConnectionPool({
    server: String(row.ServerName || process.env.DB_SERVER || ""),
    port,
    user: String(row.SqlLoginName),
    password,
    database: String(row.DatabaseName),
    connectionTimeout: 10000,
    requestTimeout: 15000,
    pool: { min: 0, max: 2, idleTimeoutMillis: 10000 },
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  });
  return pool.connect();
}

export async function getTenantSecurityRoles(tenantId: string | number | bigint) {
  const pool = await getTenantPool(tenantId);
  try {
    const result = await pool.request().query(`
      SELECT RoleId, Name, Description, IsSystem
      FROM security.Roles
      ORDER BY Name;
    `);
    return result.recordset.map((row) => ({
      roleId: String(row.RoleId),
      name: String(row.Name),
      description: row.Description == null ? "" : String(row.Description),
      isSystem: Boolean(row.IsSystem),
    }));
  } finally {
    await pool.close();
  }
}

export async function syncTenantSecurityUser(input: TenantUserInput): Promise<void> {
  if (!input.userName.trim() || input.userName.length > 100 || !input.displayName.trim() || input.displayName.length > 150) {
    throw new Error("TENANT_USER_FIELDS_INVALID");
  }
  if (!input.passwordHash) throw new Error("TENANT_USER_PASSWORD_HASH_REQUIRED");
  const pool = await getTenantPool(input.tenantId);
  try {
    await pool.request()
      .input("masterUserId", sql.BigInt, input.masterUserId)
      .input("userName", sql.NVarChar(100), input.userName.trim())
      .input("displayName", sql.NVarChar(150), input.displayName.trim())
      .input("passwordHash", sql.NVarChar(300), input.passwordHash)
      .input("isActive", sql.Bit, input.isActive ?? true)
      .input("roleId", sql.BigInt, input.roleId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE RoleId = @roleId)
          THROW 51010, 'TENANT_ROLE_NOT_FOUND', 1;

        DECLARE @userId BIGINT;
        SELECT @userId = UserId FROM security.Users WITH (UPDLOCK, HOLDLOCK)
        WHERE MasterUserId = @masterUserId;

        IF @userId IS NULL
        BEGIN
          SELECT @userId = UserId FROM security.Users
          WHERE UserName = @userName AND MasterUserId IS NULL;
          IF @userId IS NOT NULL
            UPDATE security.Users
            SET MasterUserId = @masterUserId, DisplayName = @displayName,
                PasswordHash = @passwordHash, IsActive = @isActive, UpdatedAt = SYSUTCDATETIME()
            WHERE UserId = @userId;
          ELSE
          BEGIN
            INSERT INTO security.Users (UserName, DisplayName, PasswordHash, IsActive, CreatedAt, UpdatedAt, MasterUserId)
            VALUES (@userName, @displayName, @passwordHash, @isActive, SYSUTCDATETIME(), SYSUTCDATETIME(), @masterUserId);
            SET @userId = SCOPE_IDENTITY();
          END
        END
        ELSE
          UPDATE security.Users
          SET UserName = @userName, DisplayName = @displayName,
              PasswordHash = @passwordHash, IsActive = @isActive, UpdatedAt = SYSUTCDATETIME()
          WHERE UserId = @userId;

        DELETE FROM security.UserRoles WHERE UserId = @userId;
        INSERT INTO security.UserRoles (UserId, RoleId, CreatedAt)
        VALUES (@userId, @roleId, SYSUTCDATETIME());
      `);
  } finally {
    await pool.close();
  }
}
