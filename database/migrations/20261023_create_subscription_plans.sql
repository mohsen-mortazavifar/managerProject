SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.SubscriptionPlans', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.SubscriptionPlans (
    SubscriptionPlanId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SubscriptionPlans PRIMARY KEY,
    Name NVARCHAR(120) NOT NULL,
    Description NVARCHAR(1000) NULL,
    Price DECIMAL(18,2) NOT NULL,
    DurationDays INT NOT NULL CONSTRAINT DF_SubscriptionPlans_DurationDays DEFAULT (30),
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
END
ELSE
BEGIN
  IF COL_LENGTH(N'dbo.SubscriptionPlans', N'DurationDays') IS NULL
    ALTER TABLE dbo.SubscriptionPlans ADD DurationDays INT NOT NULL CONSTRAINT DF_SubscriptionPlans_DurationDays DEFAULT (30) WITH VALUES;
  IF COL_LENGTH(N'dbo.SubscriptionPlans', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.SubscriptionPlans ADD UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SubscriptionPlans_UpdatedAt DEFAULT (SYSUTCDATETIME()) WITH VALUES;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.SubscriptionPlans') AND name = N'UX_SubscriptionPlans_Name')
BEGIN
  IF EXISTS (SELECT Name FROM dbo.SubscriptionPlans GROUP BY Name HAVING COUNT(*) > 1)
    THROW 51000, 'SubscriptionPlans contains duplicate names. Resolve duplicates before adding UX_SubscriptionPlans_Name.', 1;
  CREATE UNIQUE INDEX UX_SubscriptionPlans_Name ON dbo.SubscriptionPlans(Name);
END;

COMMIT TRANSACTION;
