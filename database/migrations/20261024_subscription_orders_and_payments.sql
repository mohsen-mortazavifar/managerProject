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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Subscriptions') AND name=N'IX_Subscriptions_Tenant_Status_Dates')
  CREATE INDEX IX_Subscriptions_Tenant_Status_Dates ON dbo.Subscriptions(TenantId, Status, StartsAt, EndsAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.PaymentTransactions') AND name=N'IX_PaymentTransactions_Tenant_CreatedAt')
  CREATE INDEX IX_PaymentTransactions_Tenant_CreatedAt ON dbo.PaymentTransactions(TenantId, CreatedAt DESC);

COMMIT TRANSACTION;
