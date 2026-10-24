SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.SubscriptionPlans', N'DiscountPercent') IS NULL
  ALTER TABLE dbo.SubscriptionPlans ADD DiscountPercent DECIMAL(5,2) NOT NULL
    CONSTRAINT DF_SubscriptionPlans_DiscountPercent DEFAULT (0) WITH VALUES;

IF COL_LENGTH(N'dbo.SubscriptionPlans', N'IsTrial') IS NULL
  ALTER TABLE dbo.SubscriptionPlans ADD IsTrial BIT NOT NULL
    CONSTRAINT DF_SubscriptionPlans_IsTrial DEFAULT (0) WITH VALUES;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.SubscriptionPlans') AND name=N'CK_SubscriptionPlans_DiscountPercent')
  ALTER TABLE dbo.SubscriptionPlans ADD CONSTRAINT CK_SubscriptionPlans_DiscountPercent CHECK (DiscountPercent >= 0 AND DiscountPercent < 100);

-- Trial plans must be free; discounting remains available only for paid plans.
IF EXISTS (SELECT 1 FROM dbo.SubscriptionPlans WHERE IsTrial=1 AND Price<>0)
  UPDATE dbo.SubscriptionPlans SET Price=0,DiscountPercent=0,UpdatedAt=SYSUTCDATETIME() WHERE IsTrial=1;

COMMIT TRANSACTION;
