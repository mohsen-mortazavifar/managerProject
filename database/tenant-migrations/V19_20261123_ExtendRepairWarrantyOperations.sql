/* V19_20261123_ExtendRepairWarrantyOperations.sql | Canonical tenant migration managed by managerProject. */
/*
  Warranty operations extension:
  - auditable warranty revocation metadata
  - line-level coverage allocation for claim review
  - dedicated warranty-issued SMS template
  Apply after 20261123_add_repair_warranty.sql in every tenant database.
*/
IF COL_LENGTH(N'repair.RepairWarranties', N'RevokedAt') IS NULL
  ALTER TABLE repair.RepairWarranties ADD RevokedAt DATETIME2(3) NULL;
IF COL_LENGTH(N'repair.RepairWarranties', N'RevokedByUserId') IS NULL
  ALTER TABLE repair.RepairWarranties ADD RevokedByUserId BIGINT NULL;
IF COL_LENGTH(N'repair.RepairWarranties', N'RevocationReason') IS NULL
  ALTER TABLE repair.RepairWarranties ADD RevocationReason NVARCHAR(1000) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name=N'FK_RepairWarranties_RevokedBy')
  ALTER TABLE repair.RepairWarranties ADD CONSTRAINT FK_RepairWarranties_RevokedBy
    FOREIGN KEY (RevokedByUserId) REFERENCES security.Users(UserId);
GO

IF OBJECT_ID(N'repair.WarrantyClaimItemDecisions', N'U') IS NULL
BEGIN
  CREATE TABLE repair.WarrantyClaimItemDecisions
  (
    WarrantyClaimItemDecisionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WarrantyClaimItemDecisions PRIMARY KEY,
    WarrantyClaimId BIGINT NOT NULL,
    ItemType NVARCHAR(20) NOT NULL,
    SourceItemId BIGINT NOT NULL,
    DescriptionSnapshot NVARCHAR(250) NOT NULL,
    QuantitySnapshot DECIMAL(12,3) NOT NULL,
    LineAmount BIGINT NOT NULL,
    CoveredAmount BIGINT NOT NULL,
    CustomerPayableAmount BIGINT NOT NULL,
    DecisionNote NVARCHAR(500) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WarrantyClaimItemDecisions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_WarrantyClaimItemDecisions_Claim FOREIGN KEY (WarrantyClaimId) REFERENCES repair.WarrantyClaims(WarrantyClaimId),
    CONSTRAINT CK_WarrantyClaimItemDecisions_Type CHECK (ItemType IN (N'Labor',N'Part')),
    CONSTRAINT CK_WarrantyClaimItemDecisions_Amounts CHECK
      (QuantitySnapshot>0 AND LineAmount>=0 AND CoveredAmount>=0 AND CustomerPayableAmount>=0
       AND CoveredAmount+CustomerPayableAmount=LineAmount),
    CONSTRAINT UQ_WarrantyClaimItemDecisions_Source UNIQUE (WarrantyClaimId,ItemType,SourceItemId)
  );
  CREATE INDEX IX_WarrantyClaimItemDecisions_Claim ON repair.WarrantyClaimItemDecisions(WarrantyClaimId,ItemType);
END;
GO

IF NOT EXISTS (SELECT 1 FROM security.Permissions WHERE PermissionKey=N'warranties.revoke')
  INSERT INTO security.Permissions(PermissionKey,Name,Module,Description)
  VALUES(N'warranties.revoke',N'ابطال گارانتی',N'warranties',N'ابطال گارانتی صادرشده با ثبت دلیل');
GO

IF EXISTS (SELECT 1 FROM security.Roles WHERE Name=N'Administrator')
BEGIN
  INSERT INTO security.RolePermissions(RoleId,PermissionId)
  SELECT r.RoleId,p.PermissionId
  FROM security.Roles r CROSS JOIN security.Permissions p
  WHERE r.Name=N'Administrator' AND p.PermissionKey=N'warranties.revoke'
    AND NOT EXISTS (SELECT 1 FROM security.RolePermissions rp WHERE rp.RoleId=r.RoleId AND rp.PermissionId=p.PermissionId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM notification.SmsTemplates WHERE Code=N'WarrantyIssued')
  INSERT INTO notification.SmsTemplates(Code,Title,Body,IsActive)
  VALUES
  (N'WarrantyIssued',N'صدور گارانتی',
   N'{CustomerName} عزیز، گارانتی دستگاه {DeviceName} صادر شد. شماره گارانتی: {WarrantyNumber} | اعتبار تا: {ExpiresAt} | شرایط: {PolicyName}',
   1);
GO
