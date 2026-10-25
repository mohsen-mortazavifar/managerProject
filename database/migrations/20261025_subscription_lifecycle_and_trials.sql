SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.SubscriptionPlans', N'IsTrial') IS NULL
  ALTER TABLE dbo.SubscriptionPlans ADD IsTrial BIT NOT NULL CONSTRAINT DF_SubscriptionPlans_IsTrial DEFAULT (0);

IF OBJECT_ID(N'dbo.TenantTrialRequests', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TenantTrialRequests (
    TrialRequestId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantTrialRequests PRIMARY KEY,
    TenantId BIGINT NOT NULL,
    SubscriptionPlanId BIGINT NOT NULL,
    SubscriptionId BIGINT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TenantTrialRequests_Status DEFAULT (N'Pending'),
    RequestedAt DATETIME2(3) NOT NULL CONSTRAINT DF_TenantTrialRequests_RequestedAt DEFAULT (SYSUTCDATETIME()),
    ReviewedAt DATETIME2(3) NULL,
    ReviewedByUserId BIGINT NULL,
    ReviewNote NVARCHAR(500) NULL,
    CONSTRAINT FK_TenantTrialRequests_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants(TenantId),
    CONSTRAINT FK_TenantTrialRequests_Plans FOREIGN KEY (SubscriptionPlanId) REFERENCES dbo.SubscriptionPlans(SubscriptionPlanId),
    CONSTRAINT FK_TenantTrialRequests_Subscriptions FOREIGN KEY (SubscriptionId) REFERENCES dbo.Subscriptions(SubscriptionId),
    CONSTRAINT CK_TenantTrialRequests_Status CHECK (Status IN (N'Pending',N'Approved',N'Rejected'))
  );
  CREATE UNIQUE INDEX UX_TenantTrialRequests_Tenant ON dbo.TenantTrialRequests(TenantId);
END;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.Subscriptions') AND name=N'CK_Subscriptions_Status')
  ALTER TABLE dbo.Subscriptions DROP CONSTRAINT CK_Subscriptions_Status;
ALTER TABLE dbo.Subscriptions ADD CONSTRAINT CK_Subscriptions_Status
  CHECK (Status IN (N'PendingPayment',N'PendingApproval',N'Active',N'Reserved',N'Expired',N'Cancelled'));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Subscriptions') AND name=N'IX_Subscriptions_OneActivePerTenant')
  CREATE UNIQUE INDEX IX_Subscriptions_OneActivePerTenant ON dbo.Subscriptions(TenantId) WHERE Status=N'Active';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Subscriptions') AND name=N'IX_Subscriptions_OneReservedPerTenant')
  CREATE UNIQUE INDEX IX_Subscriptions_OneReservedPerTenant ON dbo.Subscriptions(TenantId) WHERE Status=N'Reserved';

COMMIT TRANSACTION;
