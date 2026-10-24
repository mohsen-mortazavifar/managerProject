SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.SubscriptionPlanPriceHistory',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.SubscriptionPlanPriceHistory(
  PriceHistoryId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SubscriptionPlanPriceHistory PRIMARY KEY,
  SubscriptionPlanId BIGINT NOT NULL,
  BasePrice DECIMAL(18,2) NOT NULL,
  DiscountPercent DECIMAL(5,2) NOT NULL CONSTRAINT DF_PlanPriceHistory_Discount DEFAULT(0),
  EffectivePrice AS (CONVERT(DECIMAL(18,2), ROUND(BasePrice*(1-DiscountPercent/100.0),2))) PERSISTED,
  ValidFrom DATETIME2(3) NOT NULL,
  ValidTo DATETIME2(3) NULL,
  ChangeReason NVARCHAR(500) NULL,
  ChangedByUserId BIGINT NULL,
  CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_PlanPriceHistory_CreatedAt DEFAULT(SYSUTCDATETIME()),
  CONSTRAINT FK_PlanPriceHistory_Plan FOREIGN KEY(SubscriptionPlanId) REFERENCES dbo.SubscriptionPlans(SubscriptionPlanId),
  CONSTRAINT CK_PlanPriceHistory_Discount CHECK(DiscountPercent>=0 AND DiscountPercent<100),
  CONSTRAINT CK_PlanPriceHistory_Price CHECK(BasePrice>=0),
  CONSTRAINT CK_PlanPriceHistory_Dates CHECK(ValidTo IS NULL OR ValidTo>ValidFrom)
 );
 CREATE INDEX IX_PlanPriceHistory_Plan_Validity ON dbo.SubscriptionPlanPriceHistory(SubscriptionPlanId,ValidFrom DESC,ValidTo);
END;

IF OBJECT_ID(N'dbo.SystemEventLogs',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.SystemEventLogs(
  EventLogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SystemEventLogs PRIMARY KEY,
  EventType NVARCHAR(80) NOT NULL,
  Severity NVARCHAR(20) NOT NULL CONSTRAINT DF_SystemEventLogs_Severity DEFAULT(N'Info'),
  EntityType NVARCHAR(80) NULL,
  EntityId NVARCHAR(100) NULL,
  Message NVARCHAR(1000) NOT NULL,
  Details NVARCHAR(MAX) NULL,
  ActorUserId BIGINT NULL,
  CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SystemEventLogs_CreatedAt DEFAULT(SYSUTCDATETIME()),
  CONSTRAINT CK_SystemEventLogs_Severity CHECK(Severity IN(N'Info',N'Warning',N'Error'))
 );
 CREATE INDEX IX_SystemEventLogs_CreatedAt ON dbo.SystemEventLogs(CreatedAt DESC,EventLogId DESC);
END;

-- Seed an initial price record for every existing plan.
INSERT INTO dbo.SubscriptionPlanPriceHistory(SubscriptionPlanId,BasePrice,DiscountPercent,ValidFrom,ChangeReason)
SELECT p.SubscriptionPlanId,p.Price,COALESCE(p.DiscountPercent,0),COALESCE(p.CreatedAt,SYSUTCDATETIME()),N'ثبت اولیه تاریخچه قیمت'
FROM dbo.SubscriptionPlans p
WHERE NOT EXISTS(SELECT 1 FROM dbo.SubscriptionPlanPriceHistory h WHERE h.SubscriptionPlanId=p.SubscriptionPlanId);

COMMIT TRANSACTION;
GO

CREATE OR ALTER TRIGGER dbo.TR_SubscriptionPlans_PriceHistory_Insert
ON dbo.SubscriptionPlans
AFTER INSERT
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Now DATETIME2(3)=SYSUTCDATETIME();
 INSERT INTO dbo.SubscriptionPlanPriceHistory(SubscriptionPlanId,BasePrice,DiscountPercent,ValidFrom,ChangeReason)
 SELECT i.SubscriptionPlanId,i.Price,COALESCE(i.DiscountPercent,0),@Now,N'ایجاد پلن'
 FROM inserted i
 WHERE NOT EXISTS(SELECT 1 FROM dbo.SubscriptionPlanPriceHistory h WHERE h.SubscriptionPlanId=i.SubscriptionPlanId AND h.ValidTo IS NULL);
 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT N'SubscriptionPlan.Created',N'Info',N'SubscriptionPlan',CONVERT(NVARCHAR(100),i.SubscriptionPlanId),
  CONCAT(N'پلن ایجاد شد: ',i.Name,N'؛ قیمت پایه: ',CONVERT(NVARCHAR(40),i.Price),N'؛ تخفیف: ',CONVERT(NVARCHAR(20),COALESCE(i.DiscountPercent,0)),N'٪'),@Now
 FROM inserted i;
END;
GO

CREATE OR ALTER TRIGGER dbo.TR_SubscriptionPlans_PriceHistory
ON dbo.SubscriptionPlans
AFTER UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 IF NOT UPDATE(Price) AND NOT UPDATE(DiscountPercent) RETURN;
 DECLARE @Now DATETIME2(3)=SYSUTCDATETIME();
 DECLARE @Changed TABLE(SubscriptionPlanId BIGINT PRIMARY KEY,NewPrice DECIMAL(18,2),NewDiscount DECIMAL(5,2),OldPrice DECIMAL(18,2),OldDiscount DECIMAL(5,2));
 INSERT INTO @Changed(SubscriptionPlanId,NewPrice,NewDiscount,OldPrice,OldDiscount)
 SELECT i.SubscriptionPlanId,i.Price,COALESCE(i.DiscountPercent,0),d.Price,COALESCE(d.DiscountPercent,0)
 FROM inserted i INNER JOIN deleted d ON d.SubscriptionPlanId=i.SubscriptionPlanId
 WHERE i.Price<>d.Price OR COALESCE(i.DiscountPercent,0)<>COALESCE(d.DiscountPercent,0);

 UPDATE h SET ValidTo=@Now
 FROM dbo.SubscriptionPlanPriceHistory h
 INNER JOIN @Changed c ON c.SubscriptionPlanId=h.SubscriptionPlanId
 WHERE h.ValidTo IS NULL;

 INSERT INTO dbo.SubscriptionPlanPriceHistory(SubscriptionPlanId,BasePrice,DiscountPercent,ValidFrom,ChangeReason)
 SELECT c.SubscriptionPlanId,c.NewPrice,c.NewDiscount,@Now,
  CONCAT(N'تغییر قیمت/تخفیف از ',CONVERT(NVARCHAR(40),c.OldPrice),N' (تخفیف ',CONVERT(NVARCHAR(20),c.OldDiscount),N'٪) به ',CONVERT(NVARCHAR(40),c.NewPrice),N' (تخفیف ',CONVERT(NVARCHAR(20),c.NewDiscount),N'٪)')
 FROM @Changed c;

 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT N'SubscriptionPlan.PricingChanged',N'Info',N'SubscriptionPlan',CONVERT(NVARCHAR(100),c.SubscriptionPlanId),
  CONCAT(N'قیمت پلن تغییر کرد؛ قیمت پایه: ',CONVERT(NVARCHAR(40),c.NewPrice),N'، تخفیف: ',CONVERT(NVARCHAR(20),c.NewDiscount),N'٪'),@Now
 FROM @Changed c;
END;
GO


CREATE OR ALTER TRIGGER dbo.TR_Tenants_Audit
ON dbo.Tenants
AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT CASE WHEN d.TenantId IS NULL THEN N'Tenant.Created' ELSE N'Tenant.Updated' END,N'Info',N'Tenant',
  CONVERT(NVARCHAR(100),i.TenantId),
  CASE WHEN d.TenantId IS NULL THEN CONCAT(N'کسب‌وکار ایجاد شد: ',i.Name) ELSE CONCAT(N'اطلاعات کسب‌وکار به‌روزرسانی شد: ',i.Name,N'؛ وضعیت: ',i.Status) END,
  SYSUTCDATETIME()
 FROM inserted i LEFT JOIN deleted d ON d.TenantId=i.TenantId;
END;
GO

CREATE OR ALTER TRIGGER dbo.TR_PaymentTransactions_Audit
ON dbo.PaymentTransactions
AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT CASE WHEN d.PaymentTransactionId IS NULL THEN N'Payment.Created' ELSE N'Payment.StatusChanged' END,
  CASE WHEN i.Status IN(N'Failed',N'Refunded') THEN N'Warning' ELSE N'Info' END,
  N'Payment',CONVERT(NVARCHAR(100),i.PaymentTransactionId),
  CONCAT(N'پرداخت #',i.PaymentTransactionId,N'؛ وضعیت: ',i.Status,N'؛ مبلغ: ',CONVERT(NVARCHAR(40),i.Amount)),SYSUTCDATETIME()
 FROM inserted i LEFT JOIN deleted d ON d.PaymentTransactionId=i.PaymentTransactionId
 WHERE d.PaymentTransactionId IS NULL OR d.Status<>i.Status OR d.Amount<>i.Amount;
END;
GO
CREATE OR ALTER TRIGGER dbo.TR_TenantTrialRequests_Audit
ON dbo.TenantTrialRequests
AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT CASE WHEN d.TrialRequestId IS NULL THEN N'TrialRequest.Created' ELSE N'TrialRequest.Decided' END,
  CASE WHEN i.Status=N'Rejected' THEN N'Warning' ELSE N'Info' END,
  N'TenantTrialRequest',CONVERT(NVARCHAR(100),i.TrialRequestId),
  CONCAT(N'درخواست آزمایشی #',i.TrialRequestId,N' برای کسب‌وکار #',i.TenantId,N'؛ وضعیت: ',i.Status),SYSUTCDATETIME()
 FROM inserted i LEFT JOIN deleted d ON d.TrialRequestId=i.TrialRequestId
 WHERE d.TrialRequestId IS NULL OR d.Status<>i.Status;
END;
GO

CREATE OR ALTER TRIGGER dbo.TR_Subscriptions_Audit
ON dbo.Subscriptions
AFTER INSERT,UPDATE
AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO dbo.SystemEventLogs(EventType,Severity,EntityType,EntityId,Message,CreatedAt)
 SELECT CASE WHEN d.SubscriptionId IS NULL THEN N'Subscription.Created' ELSE N'Subscription.StatusChanged' END,
  CASE WHEN i.Status IN(N'Expired',N'Cancelled') THEN N'Warning' ELSE N'Info' END,
  N'Subscription',CONVERT(NVARCHAR(100),i.SubscriptionId),
  CONCAT(N'اشتراک #',i.SubscriptionId,N' برای کسب‌وکار #',i.TenantId,N'؛ وضعیت: ',i.Status,N'؛ مبلغ ثبت‌شده: ',CONVERT(NVARCHAR(40),i.PriceAtSubscription)),SYSUTCDATETIME()
 FROM inserted i LEFT JOIN deleted d ON d.SubscriptionId=i.SubscriptionId
 WHERE d.SubscriptionId IS NULL OR d.Status<>i.Status OR d.PriceAtSubscription<>i.PriceAtSubscription;
END;
GO
