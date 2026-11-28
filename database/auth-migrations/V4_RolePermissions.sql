SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.Permissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Permissions (
    PermissionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Permissions PRIMARY KEY,
    Code NVARCHAR(150) NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    Description NVARCHAR(500) NULL,
    CONSTRAINT UQ_Permissions_Code UNIQUE (Code)
  );
END;
IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RolePermissions (
    RoleId BIGINT NOT NULL,
    PermissionId BIGINT NOT NULL,
    AssignedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RolePermissions_AssignedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, PermissionId),
    CONSTRAINT FK_RolePermissions_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId),
    CONSTRAINT FK_RolePermissions_Permissions FOREIGN KEY (PermissionId) REFERENCES dbo.Permissions(PermissionId)
  );
END;
MERGE dbo.Permissions AS target
USING (VALUES
 (N'workspace.users.view', N'مشاهده اعضا', N'مشاهده فهرست اعضای کسب‌وکار'),
 (N'workspace.users.manage', N'مدیریت اعضا', N'دعوت و فعال/غیرفعال‌کردن اعضا'),
 (N'workspace.roles.manage', N'مدیریت نقش‌ها', N'تغییر نقش اعضای کسب‌وکار'),
 (N'repairs.view', N'مشاهده تعمیرات', N'مشاهده درخواست‌ها و سوابق تعمیر'),
 (N'repairs.create', N'ثبت تعمیر', N'ایجاد درخواست تعمیر'),
 (N'repairs.update', N'ویرایش تعمیر', N'ویرایش درخواست تعمیر'),
 (N'repairs.delete', N'حذف تعمیر', N'حذف درخواست تعمیر'),
 (N'customers.view', N'مشاهده مشتریان', N'مشاهده فهرست مشتریان'),
 (N'customers.manage', N'مدیریت مشتریان', N'ایجاد و ویرایش اطلاعات مشتریان'),
 (N'billing.view', N'مشاهده اشتراک', N'مشاهده وضعیت اشتراک و لایسنس'),
 (N'billing.manage', N'مدیریت اشتراک', N'مدیریت پلن و لایسنس کسب‌وکار'),
 (N'workspace.settings.manage', N'تنظیمات کسب‌وکار', N'مدیریت تنظیمات فضای کاری')
) AS source(Code, Name, Description)
ON target.Code = source.Code
WHEN MATCHED THEN UPDATE SET Name = source.Name, Description = source.Description
WHEN NOT MATCHED THEN INSERT (Code, Name, Description) VALUES (source.Code, source.Name, source.Description);
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId FROM dbo.Roles r CROSS JOIN dbo.Permissions p
WHERE r.Name = N'TenantManager'
  AND p.Code IN (N'workspace.users.view', N'repairs.view', N'repairs.create', N'repairs.update',
                 N'customers.view', N'customers.manage', N'billing.view', N'workspace.settings.manage')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.PermissionId = p.PermissionId);
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId FROM dbo.Roles r CROSS JOIN dbo.Permissions p
WHERE r.Name = N'TenantUser' AND p.Code IN (N'repairs.view', N'repairs.create', N'customers.view')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.PermissionId = p.PermissionId);
COMMIT TRANSACTION;
