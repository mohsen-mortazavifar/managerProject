/* V18_20261123_AddRepairWarranty.sql | Canonical tenant migration managed by managerProject. */
/*
  Repair warranty subsystem.
  Apply to every tenant operational database before deploying the warranty UI.
  Policies are manager-maintained; issued warranties retain immutable policy snapshots.
*/
IF OBJECT_ID(N'repair.RepairWarrantyPolicies', N'U') IS NULL
BEGIN
  CREATE TABLE repair.RepairWarrantyPolicies
  (
    PolicyId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairWarrantyPolicies PRIMARY KEY,
    Name NVARCHAR(120) NOT NULL,
    Description NVARCHAR(500) NULL,
    DurationDays INT NOT NULL,
    CoverageType NVARCHAR(20) NOT NULL,
    Terms NVARCHAR(2000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_RepairWarrantyPolicies_IsActive DEFAULT (1),
    CreatedByUserId BIGINT NOT NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairWarrantyPolicies_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,
    CONSTRAINT CK_RepairWarrantyPolicies_Duration CHECK (DurationDays BETWEEN 1 AND 3650),
    CONSTRAINT CK_RepairWarrantyPolicies_Coverage CHECK (CoverageType IN (N'Labor',N'Parts',N'Both')),
    CONSTRAINT FK_RepairWarrantyPolicies_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES security.Users(UserId)
  );
  CREATE UNIQUE INDEX UX_RepairWarrantyPolicies_Name ON repair.RepairWarrantyPolicies(Name);
  CREATE INDEX IX_RepairWarrantyPolicies_Active ON repair.RepairWarrantyPolicies(IsActive, Name);
END;
GO

IF OBJECT_ID(N'repair.RepairWarranties', N'U') IS NULL
BEGIN
  CREATE TABLE repair.RepairWarranties
  (
    WarrantyId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairWarranties PRIMARY KEY,
    PolicyId BIGINT NOT NULL,
    RepairOrderId BIGINT NOT NULL,
    WarrantyNumber NVARCHAR(50) NOT NULL,
    CustomerId BIGINT NOT NULL,
    DeviceId BIGINT NOT NULL,
    StartsAt DATETIME2(3) NOT NULL,
    ExpiresAt DATETIME2(3) NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_RepairWarranties_Status DEFAULT (N'Active'),
    PolicyNameSnapshot NVARCHAR(120) NOT NULL,
    DurationDaysSnapshot INT NOT NULL,
    CoverageTypeSnapshot NVARCHAR(20) NOT NULL,
    TermsSnapshot NVARCHAR(2000) NULL,
    IssuedByUserId BIGINT NOT NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairWarranties_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_RepairWarranties_RepairOrder UNIQUE (RepairOrderId),
    CONSTRAINT UQ_RepairWarranties_Number UNIQUE (WarrantyNumber),
    CONSTRAINT CK_RepairWarranties_Dates CHECK (ExpiresAt > StartsAt),
    CONSTRAINT CK_RepairWarranties_Status CHECK (Status IN (N'Active',N'Revoked')),
    CONSTRAINT FK_RepairWarranties_Policy FOREIGN KEY (PolicyId) REFERENCES repair.RepairWarrantyPolicies(PolicyId),
    CONSTRAINT FK_RepairWarranties_Customer FOREIGN KEY (CustomerId) REFERENCES crm.Customers(CustomerId),
    CONSTRAINT FK_RepairWarranties_Device FOREIGN KEY (DeviceId) REFERENCES repair.Devices(DeviceId),
    CONSTRAINT FK_RepairWarranties_Order FOREIGN KEY (RepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT FK_RepairWarranties_Issuer FOREIGN KEY (IssuedByUserId) REFERENCES security.Users(UserId)
  );
  CREATE INDEX IX_RepairWarranties_Customer ON repair.RepairWarranties(CustomerId, DeviceId, ExpiresAt);
END;
GO

IF OBJECT_ID(N'repair.RepairWarrantyItems', N'U') IS NULL
BEGIN
  CREATE TABLE repair.RepairWarrantyItems
  (
    WarrantyItemId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RepairWarrantyItems PRIMARY KEY,
    WarrantyId BIGINT NOT NULL,
    ItemType NVARCHAR(20) NOT NULL,
    Description NVARCHAR(250) NOT NULL,
    Quantity DECIMAL(12,3) NOT NULL CONSTRAINT DF_RepairWarrantyItems_Quantity DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RepairWarrantyItems_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_RepairWarrantyItems_Type CHECK (ItemType IN (N'Labor',N'Part')),
    CONSTRAINT CK_RepairWarrantyItems_Quantity CHECK (Quantity > 0),
    CONSTRAINT FK_RepairWarrantyItems_Warranty FOREIGN KEY (WarrantyId) REFERENCES repair.RepairWarranties(WarrantyId)
  );
  CREATE INDEX IX_RepairWarrantyItems_Warranty ON repair.RepairWarrantyItems(WarrantyId);
END;
GO

IF OBJECT_ID(N'repair.WarrantyClaims', N'U') IS NULL
BEGIN
  CREATE TABLE repair.WarrantyClaims
  (
    WarrantyClaimId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WarrantyClaims PRIMARY KEY,
    WarrantyId BIGINT NOT NULL,
    OriginalRepairOrderId BIGINT NOT NULL,
    ReturnRepairOrderId BIGINT NOT NULL,
    IssueDescription NVARCHAR(2000) NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_WarrantyClaims_Status DEFAULT (N'Pending'),
    DecisionReason NVARCHAR(2000) NULL,
    CustomerPayableAmount BIGINT NULL,
    ReviewedByUserId BIGINT NULL,
    ReviewedAt DATETIME2(3) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WarrantyClaims_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_WarrantyClaims_ReturnOrder UNIQUE (ReturnRepairOrderId),
    CONSTRAINT CK_WarrantyClaims_Status CHECK (Status IN (N'Pending',N'Approved',N'Rejected',N'PartiallyApproved')),
    CONSTRAINT CK_WarrantyClaims_CustomerPayable CHECK (CustomerPayableAmount IS NULL OR CustomerPayableAmount >= 0),
    CONSTRAINT FK_WarrantyClaims_Warranty FOREIGN KEY (WarrantyId) REFERENCES repair.RepairWarranties(WarrantyId),
    CONSTRAINT FK_WarrantyClaims_OriginalOrder FOREIGN KEY (OriginalRepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT FK_WarrantyClaims_ReturnOrder FOREIGN KEY (ReturnRepairOrderId) REFERENCES repair.RepairOrders(RepairOrderId),
    CONSTRAINT FK_WarrantyClaims_Reviewer FOREIGN KEY (ReviewedByUserId) REFERENCES security.Users(UserId)
  );
  CREATE INDEX IX_WarrantyClaims_Warranty ON repair.WarrantyClaims(WarrantyId, CreatedAt DESC);
  CREATE INDEX IX_WarrantyClaims_Status ON repair.WarrantyClaims(Status, CreatedAt DESC);
END;
GO


/* Remove the retired order status from any tenant CHECK constraint and prevent it from being stored again. */
DECLARE @LegacyStatusConstraint sysname;
DECLARE legacy_status_constraints CURSOR LOCAL FAST_FORWARD FOR
  SELECT name
  FROM sys.check_constraints
  WHERE parent_object_id=OBJECT_ID(N'repair.RepairOrders')
    AND definition LIKE N'%ReturnedUnderWarranty%';
OPEN legacy_status_constraints;
FETCH NEXT FROM legacy_status_constraints INTO @LegacyStatusConstraint;
WHILE @@FETCH_STATUS=0
BEGIN
  DECLARE @DropConstraintSql NVARCHAR(MAX);
  SET @DropConstraintSql =
    N'ALTER TABLE repair.RepairOrders DROP CONSTRAINT '
    + QUOTENAME(@LegacyStatusConstraint)
    + N';';
  EXEC sys.sp_executesql @DropConstraintSql;
  FETCH NEXT FROM legacy_status_constraints INTO @LegacyStatusConstraint;
END;
CLOSE legacy_status_constraints;
DEALLOCATE legacy_status_constraints;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'repair.RepairOrders')
    AND name = N'CK_RepairOrders_CurrentStatus_Warranty'
)
BEGIN
  ALTER TABLE repair.RepairOrders WITH CHECK
    ADD CONSTRAINT CK_RepairOrders_CurrentStatus_Warranty
    CHECK (CurrentStatus IN
      (N'Received',N'Diagnosing',N'WaitingCustomerApproval',N'WaitingPart',
       N'Repairing',N'Repaired',N'ReadyForDelivery',N'Delivered',N'Cancelled'));
END;
GO

/* Add permissions only when absent. Administrators can assign them through Roles & Access. */
IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey=N'warranties.view')
  INSERT INTO security.Permissions(PermissionKey,Name,Module,Description)
  VALUES(N'warranties.view',N'مشاهده گارانتی‌ها',N'warranties',N'مشاهده قوانین، گارانتی‌ها و درخواست‌ها');
IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey=N'warranties.policies.manage')
  INSERT INTO security.Permissions(PermissionKey,Name,Module,Description)
  VALUES(N'warranties.policies.manage',N'مدیریت قوانین گارانتی',N'warranties',N'ایجاد و ویرایش قوانین گارانتی کسب‌وکار');
IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey=N'warranties.issue')
  INSERT INTO security.Permissions(PermissionKey,Name,Module,Description)
  VALUES(N'warranties.issue',N'صدور گارانتی',N'warranties',N'صدور گارانتی برای سفارش تعمیر تحویل‌شده');
IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey=N'warranties.claims.review')
  INSERT INTO security.Permissions(PermissionKey,Name,Module,Description)
  VALUES(N'warranties.claims.review',N'بررسی درخواست گارانتی',N'warranties',N'تأیید، رد یا تأیید جزئی درخواست گارانتی');
GO

/* The built-in Administrator role receives the new module permissions by default. */
INSERT INTO security.RolePermissions(RoleId,PermissionId)
SELECT r.RoleId,p.PermissionId
FROM security.Roles r
CROSS JOIN security.Permissions p
WHERE r.Name=N'Administrator'
  AND p.PermissionKey IN
    (N'warranties.view',N'warranties.policies.manage',N'warranties.issue',N'warranties.claims.review')
  AND NOT EXISTS
    (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=r.RoleId AND rp.PermissionId=p.PermissionId);
GO
