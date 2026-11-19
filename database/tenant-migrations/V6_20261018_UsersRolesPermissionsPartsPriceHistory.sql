/*
  User accounts, role-based access control, inventory parts, and auditable price history.
  Apply once to the Repair database before deploying the matching application code.
  Idempotent: existing repair/inventory data is preserved.
*/
SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'security') IS NULL EXEC(N'CREATE SCHEMA security AUTHORIZATION dbo;');
IF SCHEMA_ID(N'inventory') IS NULL EXEC(N'CREATE SCHEMA inventory AUTHORIZATION dbo;');
GO

IF OBJECT_ID(N'security.Users', N'U') IS NULL
BEGIN
  CREATE TABLE security.Users (
    UserId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Users PRIMARY KEY,
    UserName NVARCHAR(100) NOT NULL,
    DisplayName NVARCHAR(150) NOT NULL,
    PasswordHash NVARCHAR(300) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_security_Users_IsActive DEFAULT (1),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2(0) NULL,
    LastLoginAt DATETIME2(0) NULL
  );
  CREATE UNIQUE INDEX UX_security_Users_UserName ON security.Users(UserName);
END;
GO
IF OBJECT_ID(N'security.Roles', N'U') IS NULL
BEGIN
  CREATE TABLE security.Roles (
    RoleId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Roles PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Description NVARCHAR(300) NULL,
    IsSystem BIT NOT NULL CONSTRAINT DF_security_Roles_IsSystem DEFAULT (0),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_Roles_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX UX_security_Roles_Name ON security.Roles(Name);
END;
GO
IF OBJECT_ID(N'security.Permissions', N'U') IS NULL
BEGIN
  CREATE TABLE security.Permissions (
    PermissionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_security_Permissions PRIMARY KEY,
    PermissionKey NVARCHAR(100) NOT NULL,
    Name NVARCHAR(150) NOT NULL,
    Module NVARCHAR(80) NOT NULL,
    Description NVARCHAR(300) NULL
  );
  CREATE UNIQUE INDEX UX_security_Permissions_Key ON security.Permissions(PermissionKey);
END;
GO
IF OBJECT_ID(N'security.UserRoles', N'U') IS NULL
BEGIN
  CREATE TABLE security.UserRoles (
    UserId BIGINT NOT NULL,
    RoleId BIGINT NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_UserRoles_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_security_UserRoles PRIMARY KEY (UserId, RoleId),
    CONSTRAINT FK_security_UserRoles_Users FOREIGN KEY (UserId) REFERENCES security.Users(UserId),
    CONSTRAINT FK_security_UserRoles_Roles FOREIGN KEY (RoleId) REFERENCES security.Roles(RoleId)
  );
  CREATE INDEX IX_security_UserRoles_RoleId ON security.UserRoles(RoleId);
END;
GO
IF OBJECT_ID(N'security.RolePermissions', N'U') IS NULL
BEGIN
  CREATE TABLE security.RolePermissions (
    RoleId BIGINT NOT NULL,
    PermissionId BIGINT NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_security_RolePermissions_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_security_RolePermissions PRIMARY KEY (RoleId, PermissionId),
    CONSTRAINT FK_security_RolePermissions_Roles FOREIGN KEY (RoleId) REFERENCES security.Roles(RoleId),
    CONSTRAINT FK_security_RolePermissions_Permissions FOREIGN KEY (PermissionId) REFERENCES security.Permissions(PermissionId)
  );
  CREATE INDEX IX_security_RolePermissions_PermissionId ON security.RolePermissions(PermissionId);
END;
GO

DECLARE @Permissions TABLE (PermissionKey NVARCHAR(100), Name NVARCHAR(150), Module NVARCHAR(80), Description NVARCHAR(300));
INSERT INTO @Permissions (PermissionKey, Name, Module, Description) VALUES
(N'dashboard.view', N'مشاهده داشبورد', N'dashboard', N'دسترسی به داشبورد اصلی'),
(N'repairs.view', N'مشاهده سفارش‌های تعمیر', N'repairs', N'مشاهده و جست‌وجوی سفارش‌ها'),
(N'repairs.status.change', N'تغییر وضعیت تعمیر', N'repairs', N'تغییر وضعیت سفارش تعمیر'),
(N'repairs.deliver', N'ثبت تحویل دستگاه', N'repairs', N'ثبت تحویل و اطلاعات گیرنده'),
(N'repairs.images.manage', N'مدیریت تصاویر تعمیر', N'repairs', N'بارگذاری تصاویر سفارش'),
(N'costing.view', N'مشاهده هزینه‌ها', N'costing', N'مشاهده خدمات و قطعات سفارش'),
(N'costing.manage', N'ویرایش هزینه‌ها', N'costing', N'ثبت و ویرایش اقلام هزینه'),
(N'costing.finalize', N'نهایی‌سازی هزینه', N'costing', N'تأیید هزینه نهایی'),
(N'services.manage', N'مدیریت فهرست خدمات', N'services', N'تعریف خدمات قابل استفاده مجدد'),
(N'inventory.parts.view', N'مشاهده قطعات', N'inventory', N'مشاهده فهرست قطعات'),
(N'inventory.parts.manage', N'مدیریت قطعات', N'inventory', N'تعریف و ویرایش قطعات'),
(N'inventory.prices.view', N'مشاهده تاریخچه قیمت', N'inventory', N'مشاهده سوابق تغییر قیمت'),
(N'inventory.prices.manage', N'تغییر قیمت قطعات', N'inventory', N'ثبت قیمت جدید و تاریخچه آن'),
(N'users.view', N'مشاهده کاربران', N'access', N'مشاهده حساب‌های کاربری'),
(N'users.manage', N'مدیریت کاربران', N'access', N'تعریف، ویرایش و غیرفعال‌سازی کاربران'),
(N'roles.view', N'مشاهده نقش‌ها و مجوزها', N'access', N'مشاهده نقش‌ها و فهرست مجوزها'),
(N'roles.manage', N'مدیریت نقش‌ها و مجوزها', N'access', N'تعریف نقش و تخصیص مجوزها'),
(N'notifications.manage', N'مدیریت پیامک‌ها', N'notifications', N'مدیریت عملیات پیامک و اعلان‌ها');

INSERT INTO security.Permissions (PermissionKey, Name, Module, Description)
SELECT p.PermissionKey, p.Name, p.Module, p.Description
FROM @Permissions p
WHERE NOT EXISTS (SELECT 1 FROM security.Permissions x WHERE x.PermissionKey = p.PermissionKey);
GO

IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Administrator')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Administrator', N'دسترسی کامل مدیریتی', 1);
IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Technician')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Technician', N'دسترسی عملیاتی تعمیرکار', 1);
IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Name = N'Reception')
  INSERT INTO security.Roles (Name, Description, IsSystem) VALUES (N'Reception', N'دسترسی پذیرش و پیگیری سفارش', 1);

DECLARE @AdminRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Administrator');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @AdminRoleId, p.PermissionId FROM security.Permissions p
WHERE NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@AdminRoleId AND rp.PermissionId=p.PermissionId);

DECLARE @TechnicianRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Technician');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @TechnicianRoleId, p.PermissionId
FROM security.Permissions p
WHERE p.PermissionKey IN (N'dashboard.view',N'repairs.view',N'repairs.status.change',N'repairs.images.manage',N'costing.view',N'costing.manage',N'inventory.parts.view',N'inventory.prices.view')
AND NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@TechnicianRoleId AND rp.PermissionId=p.PermissionId);

DECLARE @ReceptionRoleId BIGINT = (SELECT RoleId FROM security.Roles WHERE Name=N'Reception');
INSERT INTO security.RolePermissions (RoleId, PermissionId)
SELECT @ReceptionRoleId, p.PermissionId
FROM security.Permissions p
WHERE p.PermissionKey IN (N'dashboard.view',N'repairs.view',N'repairs.status.change',N'repairs.deliver',N'repairs.images.manage',N'costing.view',N'inventory.parts.view',N'inventory.prices.view')
AND NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=@ReceptionRoleId AND rp.PermissionId=p.PermissionId);
GO

/* Create the inventory catalog only if it does not exist. */
IF OBJECT_ID(N'inventory.Parts', N'U') IS NULL
BEGIN
  CREATE TABLE inventory.Parts (
    PartId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_Parts PRIMARY KEY,
    Name NVARCHAR(150) NOT NULL,
    Description NVARCHAR(500) NULL,
    CurrentPrice BIGINT NOT NULL CONSTRAINT DF_inventory_Parts_CurrentPrice DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_inventory_Parts_IsActive DEFAULT (1),
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_inventory_Parts_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2(0) NULL,
    CONSTRAINT CK_inventory_Parts_CurrentPrice CHECK (CurrentPrice >= 0)
  );
  CREATE INDEX IX_inventory_Parts_ActiveName ON inventory.Parts(IsActive, Name);
END;
GO
IF COL_LENGTH(N'inventory.Parts', N'Name') IS NULL
   OR COL_LENGTH(N'inventory.Parts', N'CurrentPrice') IS NULL
   OR COL_LENGTH(N'inventory.Parts', N'IsActive') IS NULL
  THROW 51100, 'inventory.Parts has an incompatible schema; expected Name, CurrentPrice, and IsActive.', 1;
IF COL_LENGTH(N'inventory.Parts', N'Description') IS NULL
  ALTER TABLE inventory.Parts ADD Description NVARCHAR(500) NULL;
IF COL_LENGTH(N'inventory.Parts', N'CreatedAt') IS NULL
  ALTER TABLE inventory.Parts ADD CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_inventory_Parts_CreatedAt DEFAULT SYSUTCDATETIME();
IF COL_LENGTH(N'inventory.Parts', N'UpdatedAt') IS NULL
  ALTER TABLE inventory.Parts ADD UpdatedAt DATETIME2(0) NULL;
/* Optional catalog fields: existing parts remain valid with NULL values. */
IF COL_LENGTH(N'inventory.Parts', N'PartNumber') IS NULL
  ALTER TABLE inventory.Parts ADD PartNumber NVARCHAR(100) NULL;
IF COL_LENGTH(N'inventory.Parts', N'Category') IS NULL
  ALTER TABLE inventory.Parts ADD Category NVARCHAR(150) NULL;
GO
IF OBJECT_ID(N'inventory.PartPriceHistory', N'U') IS NULL
BEGIN
  CREATE TABLE inventory.PartPriceHistory (
    PartPriceHistoryId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_PartPriceHistory PRIMARY KEY,
    PartId BIGINT NOT NULL,
    Price BIGINT NOT NULL,
    EffectiveFrom DATETIME2(0) NOT NULL CONSTRAINT DF_inventory_PartPriceHistory_EffectiveFrom DEFAULT SYSUTCDATETIME(),
    EffectiveTo DATETIME2(0) NULL,
    ChangedByUserId BIGINT NULL,
    CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_inventory_PartPriceHistory_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_inventory_PartPriceHistory_Parts FOREIGN KEY (PartId) REFERENCES inventory.Parts(PartId),
    CONSTRAINT FK_inventory_PartPriceHistory_Users FOREIGN KEY (ChangedByUserId) REFERENCES security.Users(UserId),
    CONSTRAINT CK_inventory_PartPriceHistory_Price CHECK (Price >= 0),
    CONSTRAINT CK_inventory_PartPriceHistory_EffectivePeriod CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
  );
END;
GO

/* Upgrade the earlier draft schema in place without deleting existing price records. */
IF COL_LENGTH(N'inventory.PartPriceHistory', N'Price') IS NULL
  ALTER TABLE inventory.PartPriceHistory ADD Price BIGINT NULL;
IF COL_LENGTH(N'inventory.PartPriceHistory', N'EffectiveFrom') IS NULL
  ALTER TABLE inventory.PartPriceHistory ADD EffectiveFrom DATETIME2(0) NULL;
IF COL_LENGTH(N'inventory.PartPriceHistory', N'EffectiveTo') IS NULL
  ALTER TABLE inventory.PartPriceHistory ADD EffectiveTo DATETIME2(0) NULL;
IF COL_LENGTH(N'inventory.PartPriceHistory', N'CreatedAt') IS NULL
  ALTER TABLE inventory.PartPriceHistory ADD CreatedAt DATETIME2(0) NULL;
GO

/* Convert legacy NewPrice/ChangedAt rows into effective-dated prices where those columns exist. */
IF COL_LENGTH(N'inventory.PartPriceHistory', N'NewPrice') IS NOT NULL
  EXEC(N'UPDATE inventory.PartPriceHistory SET Price = COALESCE(Price, NewPrice) WHERE Price IS NULL;');
IF COL_LENGTH(N'inventory.PartPriceHistory', N'ChangedAt') IS NOT NULL
  EXEC(N'UPDATE inventory.PartPriceHistory SET EffectiveFrom = COALESCE(EffectiveFrom, ChangedAt) WHERE EffectiveFrom IS NULL;');
UPDATE h
SET Price = COALESCE(h.Price, p.CurrentPrice),
    EffectiveFrom = COALESCE(h.EffectiveFrom, h.CreatedAt, p.CreatedAt, SYSUTCDATETIME()),
    CreatedAt = COALESCE(h.CreatedAt, h.EffectiveFrom, p.CreatedAt, SYSUTCDATETIME())
FROM inventory.PartPriceHistory h
JOIN inventory.Parts p ON p.PartId=h.PartId
WHERE h.Price IS NULL OR h.EffectiveFrom IS NULL OR h.CreatedAt IS NULL;

IF EXISTS (SELECT 1 FROM inventory.PartPriceHistory WHERE Price IS NULL OR EffectiveFrom IS NULL OR CreatedAt IS NULL)
  THROW 51101, 'Unable to migrate inventory.PartPriceHistory to effective-dated prices.', 1;

ALTER TABLE inventory.PartPriceHistory ALTER COLUMN Price BIGINT NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'inventory.PartPriceHistory') AND name=N'NewPrice' AND is_nullable=0)
  ALTER TABLE inventory.PartPriceHistory ALTER COLUMN NewPrice BIGINT NULL;
GO

/* Close each legacy price at the next price's start time, preserving a single open-ended current row. */
;WITH OrderedPrices AS (
  SELECT PartPriceHistoryId, EffectiveFrom,
         LEAD(EffectiveFrom) OVER (PARTITION BY PartId ORDER BY EffectiveFrom, PartPriceHistoryId) AS NextEffectiveFrom
  FROM inventory.PartPriceHistory
)
UPDATE h
SET EffectiveTo = o.NextEffectiveFrom
FROM inventory.PartPriceHistory h
JOIN OrderedPrices o ON o.PartPriceHistoryId=h.PartPriceHistoryId
WHERE o.NextEffectiveFrom IS NOT NULL
  AND (h.EffectiveTo IS NULL OR h.EffectiveTo > o.NextEffectiveFrom);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'inventory.PartPriceHistory') AND name=N'IX_inventory_PartPriceHistory_PartEffective')
  CREATE INDEX IX_inventory_PartPriceHistory_PartEffective ON inventory.PartPriceHistory(PartId, EffectiveFrom DESC, PartPriceHistoryId DESC);
GO

/* Seed only parts without a currently effective price; don't fabricate a price-change event. */
INSERT INTO inventory.PartPriceHistory (PartId, Price, EffectiveFrom, EffectiveTo, ChangedByUserId, CreatedAt)
SELECT p.PartId, p.CurrentPrice, SYSUTCDATETIME(), NULL, NULL, SYSUTCDATETIME()
FROM inventory.Parts p
WHERE NOT EXISTS (
  SELECT 1 FROM inventory.PartPriceHistory h WHERE h.PartId=p.PartId AND h.EffectiveTo IS NULL
);
GO