SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.Subscriptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Subscriptions (
    SubscriptionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Subscriptions PRIMARY KEY,
    TenantId BIGINT NOT NULL,
    SubscriptionPlanId BIGINT NOT NULL,
    Status NVARCHAR(30) NOT NULL CONSTRAINT DF_Subscriptions_Status DEFAULT (N'PendingPayment'),
    StartsAt DATETIME2(3) NOT NULL,
    EndsAt DATETIME2(3) NOT NULL,
    PriceAtSubscription DECIMAL(18,2) NOT NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Subscriptions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Subscriptions_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Subscriptions_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants(TenantId),
    CONSTRAINT FK_Subscriptions_Plans FOREIGN KEY (SubscriptionPlanId) REFERENCES dbo.SubscriptionPlans(SubscriptionPlanId),
    CONSTRAINT CK_Subscriptions_Status CHECK (Status IN (N'PendingPayment',N'Active',N'Expired',N'Cancelled')),
    CONSTRAINT CK_Subscriptions_Dates CHECK (EndsAt > StartsAt),
    CONSTRAINT CK_Subscriptions_Price CHECK (PriceAtSubscription >= 0)
  );
END;

IF OBJECT_ID(N'dbo.PaymentTransactions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PaymentTransactions (
    PaymentTransactionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PaymentTransactions PRIMARY KEY,
    TenantId BIGINT NOT NULL,
    SubscriptionId BIGINT NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    Status NVARCHAR(30) NOT NULL CONSTRAINT DF_PaymentTransactions_Status DEFAULT (N'Pending'),
    Gateway NVARCHAR(50) NOT NULL CONSTRAINT DF_PaymentTransactions_Gateway DEFAULT (N'Manual'),
    GatewayTransactionId NVARCHAR(200) NULL,
    PaidAt DATETIME2(3) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_PaymentTransactions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_PaymentTransactions_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants(TenantId),
    CONSTRAINT FK_PaymentTransactions_Subscriptions FOREIGN KEY (SubscriptionId) REFERENCES dbo.Subscriptions(SubscriptionId),
    CONSTRAINT CK_PaymentTransactions_Amount CHECK (Amount >= 0),
    CONSTRAINT CK_PaymentTransactions_Status CHECK (Status IN (N'Pending',N'Paid',N'Failed',N'Refunded'))
  );
END;


/* Fail clearly rather than allowing the API to run against a partial legacy schema. */
IF COL_LENGTH(N'dbo.Subscriptions', N'SubscriptionId') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'TenantId') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'SubscriptionPlanId') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'Status') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'StartsAt') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'EndsAt') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'PriceAtSubscription') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'CreatedAt') IS NULL
 OR COL_LENGTH(N'dbo.Subscriptions', N'UpdatedAt') IS NULL
  THROW 51010, 'dbo.Subscriptions exists but is missing required columns. Compare it with docs/validate-schema.sql before continuing.', 1;

IF COL_LENGTH(N'dbo.PaymentTransactions', N'PaymentTransactionId') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'TenantId') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'SubscriptionId') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'Amount') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'Status') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'Gateway') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'GatewayTransactionId') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'PaidAt') IS NULL
 OR COL_LENGTH(N'dbo.PaymentTransactions', N'CreatedAt') IS NULL
  THROW 51011, 'dbo.PaymentTransactions exists but is missing required columns. Compare it with docs/validate-schema.sql before continuing.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Subscriptions') AND name=N'IX_Subscriptions_Tenant_Status_Dates')
  CREATE INDEX IX_Subscriptions_Tenant_Status_Dates ON dbo.Subscriptions(TenantId, Status, StartsAt, EndsAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.PaymentTransactions') AND name=N'IX_PaymentTransactions_Tenant_CreatedAt')
  CREATE INDEX IX_PaymentTransactions_Tenant_CreatedAt ON dbo.PaymentTransactions(TenantId, CreatedAt DESC);

COMMIT TRANSACTION;
