SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.SystemRoles',N'U') IS NULL BEGIN
 CREATE TABLE dbo.SystemRoles(SystemRoleId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SystemRoles PRIMARY KEY,Code NVARCHAR(80) NOT NULL CONSTRAINT UQ_SystemRoles_Code UNIQUE,Name NVARCHAR(150) NOT NULL,Description NVARCHAR(500) NULL,IsSystemRole BIT NOT NULL CONSTRAINT DF_SystemRoles_IsSystemRole DEFAULT(1),IsActive BIT NOT NULL CONSTRAINT DF_SystemRoles_IsActive DEFAULT(1),CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SystemRoles_CreatedAt DEFAULT SYSUTCDATETIME());
END;
IF OBJECT_ID(N'dbo.SystemPermissions',N'U') IS NULL BEGIN
 CREATE TABLE dbo.SystemPermissions(SystemPermissionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SystemPermissions PRIMARY KEY,Code NVARCHAR(150) NOT NULL CONSTRAINT UQ_SystemPermissions_Code UNIQUE,Name NVARCHAR(200) NOT NULL,Description NVARCHAR(500) NULL,Category NVARCHAR(80) NOT NULL,IsActive BIT NOT NULL CONSTRAINT DF_SystemPermissions_IsActive DEFAULT(1));
END;
IF OBJECT_ID(N'dbo.SystemUserRoles',N'U') IS NULL BEGIN
 CREATE TABLE dbo.SystemUserRoles(UserId BIGINT NOT NULL,SystemRoleId BIGINT NOT NULL,AssignedByUserId BIGINT NULL,AssignedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SystemUserRoles_AssignedAt DEFAULT SYSUTCDATETIME(),CONSTRAINT PK_SystemUserRoles PRIMARY KEY(UserId,SystemRoleId),CONSTRAINT FK_SystemUserRoles_Users FOREIGN KEY(UserId) REFERENCES dbo.Users(UserId),CONSTRAINT FK_SystemUserRoles_SystemRoles FOREIGN KEY(SystemRoleId) REFERENCES dbo.SystemRoles(SystemRoleId),CONSTRAINT FK_SystemUserRoles_AssignedBy FOREIGN KEY(AssignedByUserId) REFERENCES dbo.Users(UserId));
 CREATE INDEX IX_SystemUserRoles_RoleId ON dbo.SystemUserRoles(SystemRoleId,UserId);
END;
IF OBJECT_ID(N'dbo.SystemRolePermissions',N'U') IS NULL BEGIN
 CREATE TABLE dbo.SystemRolePermissions(SystemRoleId BIGINT NOT NULL,SystemPermissionId BIGINT NOT NULL,AssignedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SystemRolePermissions_AssignedAt DEFAULT SYSUTCDATETIME(),CONSTRAINT PK_SystemRolePermissions PRIMARY KEY(SystemRoleId,SystemPermissionId),CONSTRAINT FK_SystemRolePermissions_Roles FOREIGN KEY(SystemRoleId) REFERENCES dbo.SystemRoles(SystemRoleId),CONSTRAINT FK_SystemRolePermissions_Permissions FOREIGN KEY(SystemPermissionId) REFERENCES dbo.SystemPermissions(SystemPermissionId));
END;
MERGE dbo.SystemRoles AS t USING (VALUES
(N'SYSTEM_ADMIN',N'مدیر کل سیستم',N'مدیریت کامل پلتفرم'),
(N'TECHNICAL_MANAGER',N'مسئول فنی',N'بررسی دیتابیس، سلامت سامانه و رخدادهای فنی'),
(N'CUSTOMER_SUCCESS',N'مسئول مشتریان و بازاریابی',N'پیگیری مشتریان، تمدید قرارداد و بازاریابی'),
(N'SUPPORT_AGENT',N'مسئول پیگیری مشکلات',N'مدیریت تیکت‌ها و مشکلات مشتریان')
) AS s(Code,Name,Description) ON t.Code=s.Code
WHEN MATCHED THEN UPDATE SET Name=s.Name,Description=s.Description,IsActive=1
WHEN NOT MATCHED THEN INSERT(Code,Name,Description) VALUES(s.Code,s.Name,s.Description);
MERGE dbo.SystemPermissions AS t USING (VALUES
(N'dashboard.view',N'مشاهده داشبورد',N'دسترسی به داشبورد مدیریت',N'dashboard'),
(N'tenants.view',N'مشاهده کسب‌وکارها',N'مشاهده فهرست و جزئیات کسب‌وکارها',N'tenants'),
(N'tenants.update',N'ویرایش کسب‌وکارها',N'ویرایش اطلاعات کسب‌وکار',N'tenants'),
(N'tenants.suspend',N'تعلیق کسب‌وکارها',N'تعلیق یا فعال‌سازی کسب‌وکار',N'tenants'),
(N'subscriptions.view',N'مشاهده اشتراک‌ها',N'مشاهده پلن‌ها و قراردادها',N'subscriptions'),
(N'subscriptions.manage',N'مدیریت اشتراک‌ها',N'تمدید و مدیریت اشتراک',N'subscriptions'),
(N'payments.view',N'مشاهده پرداخت‌ها',N'مشاهده تراکنش‌ها',N'payments'),
(N'payments.manage',N'مدیریت پرداخت‌ها',N'مدیریت وضعیت پرداخت',N'payments'),
(N'databases.view',N'مشاهده دیتابیس‌ها',N'مشاهده دیتابیس کسب‌وکارها',N'databases'),
(N'databases.diagnostics',N'بررسی فنی دیتابیس',N'تست اتصال، Schema و Backup',N'databases'),
(N'events.view',N'مشاهده گزارش رخدادها',N'گزارش رویدادهای مدیریتی',N'events'),
(N'pricing.view',N'مشاهده تاریخچه قیمت',N'مشاهده تاریخچه قیمت‌گذاری',N'pricing'),
(N'customers.followup',N'پیگیری مشتریان',N'پیگیری مشتریان و تمدید قرارداد',N'customers'),
(N'marketing.manage',N'مدیریت بازاریابی',N'فعالیت‌های بازاریابی',N'marketing'),
(N'tickets.view',N'مشاهده مشکلات',N'مشاهده تیکت‌های مشتریان',N'tickets'),
(N'tickets.create',N'ثبت مشکل',N'ایجاد تیکت پشتیبانی',N'tickets'),
(N'tickets.assign',N'ارجاع مشکل',N'تخصیص تیکت به مسئول',N'tickets'),
(N'tickets.resolve',N'حل مشکل',N'تغییر وضعیت و بستن تیکت',N'tickets'),
(N'system.users.manage',N'مدیریت کاربران پنل',N'تخصیص نقش و فعال‌سازی کاربر داخلی',N'system-access'),
(N'system.roles.manage',N'مدیریت نقش‌ها',N'مدیریت نقش و مجوزها',N'system-access'),
(N'system.permissions.manage',N'مدیریت مجوزها',N'تنظیم مجوزهای نقش‌ها',N'system-access')
) AS s(Code,Name,Description,Category) ON t.Code=s.Code
WHEN MATCHED THEN UPDATE SET Name=s.Name,Description=s.Description,Category=s.Category,IsActive=1
WHEN NOT MATCHED THEN INSERT(Code,Name,Description,Category) VALUES(s.Code,s.Name,s.Description,s.Category);
INSERT dbo.SystemRolePermissions(SystemRoleId,SystemPermissionId)
SELECT r.SystemRoleId,p.SystemPermissionId FROM dbo.SystemRoles r CROSS JOIN dbo.SystemPermissions p
WHERE (
 (r.Code=N'TECHNICAL_MANAGER' AND p.Code IN(N'dashboard.view',N'tenants.view',N'databases.view',N'databases.diagnostics',N'events.view'))
 OR (r.Code=N'CUSTOMER_SUCCESS' AND p.Code IN(N'dashboard.view',N'tenants.view',N'subscriptions.view',N'subscriptions.manage',N'customers.followup',N'marketing.manage'))
 OR (r.Code=N'SUPPORT_AGENT' AND p.Code IN(N'dashboard.view',N'tenants.view',N'tickets.view',N'tickets.create',N'tickets.assign',N'tickets.resolve'))
)
AND NOT EXISTS(SELECT 1 FROM dbo.SystemRolePermissions x WHERE x.SystemRoleId=r.SystemRoleId AND x.SystemPermissionId=p.SystemPermissionId);
INSERT dbo.SystemUserRoles(UserId,SystemRoleId)
SELECT u.UserId,r.SystemRoleId FROM dbo.Users u CROSS JOIN dbo.SystemRoles r
WHERE u.IsSystemAdmin=1 AND r.Code=N'SYSTEM_ADMIN' AND NOT EXISTS(SELECT 1 FROM dbo.SystemUserRoles x WHERE x.UserId=u.UserId AND x.SystemRoleId=r.SystemRoleId);
COMMIT TRANSACTION;