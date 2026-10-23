SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.SubscriptionPlans', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.SubscriptionPlans (
  SubscriptionPlanId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SubscriptionPlans PRIMARY KEY,
  Name NVARCHAR(120) NOT NULL,
  Description NVARCHAR(1000) NULL,
  Price DECIMAL(18,2) NOT NULL,
  DurationDays INT NOT NULL,
  MaxBranches INT NOT NULL,
  MaxUsers INT NOT NULL,
  MaxSmsPerMonth INT NOT NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_SubscriptionPlans_IsActive DEFAULT (1),
  CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SubscriptionPlans_CreatedAt DEFAULT (SYSUTCDATETIME()),
  UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SubscriptionPlans_UpdatedAt DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT CK_SubscriptionPlans_Price CHECK (Price >= 0),
  CONSTRAINT CK_SubscriptionPlans_DurationDays CHECK (DurationDays > 0),
  CONSTRAINT CK_SubscriptionPlans_MaxBranches CHECK (MaxBranches >= 0),
  CONSTRAINT CK_SubscriptionPlans_MaxUsers CHECK (MaxUsers >= 0),
  CONSTRAINT CK_SubscriptionPlans_MaxSmsPerMonth CHECK (MaxSmsPerMonth >= 0)
 );
 CREATE UNIQUE INDEX UX_SubscriptionPlans_Name ON dbo.SubscriptionPlans(Name);
END;
COMMIT TRANSACTION;