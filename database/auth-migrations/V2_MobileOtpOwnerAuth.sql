SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Owners authenticate with a verified mobile number; system admins keep email/password.
IF COL_LENGTH('dbo.Users', 'MobileVerifiedAt') IS NULL
  ALTER TABLE dbo.Users ADD MobileVerifiedAt datetime2(3) NULL;

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Email' AND is_nullable = 0
)
  ALTER TABLE dbo.Users ALTER COLUMN Email nvarchar(255) NULL;

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'PasswordHash' AND is_nullable = 0
)
  ALTER TABLE dbo.Users ALTER COLUMN PasswordHash nvarchar(1000) NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'UQ_Users_Email'
)
  DROP INDEX UQ_Users_Email ON dbo.Users;

CREATE UNIQUE INDEX UQ_Users_Email
  ON dbo.Users(Email)
  WHERE Email IS NOT NULL;

IF OBJECT_ID('dbo.OwnerOtpChallenges', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OwnerOtpChallenges (
    ChallengeId uniqueidentifier NOT NULL CONSTRAINT PK_OwnerOtpChallenges PRIMARY KEY
      CONSTRAINT DF_OwnerOtpChallenges_Id DEFAULT NEWSEQUENTIALID(),
    Mobile nvarchar(40) NOT NULL,
    Purpose varchar(16) NOT NULL,
    FullName nvarchar(200) NULL,
    BusinessName nvarchar(200) NULL,
    OtpHash varbinary(32) NOT NULL,
    ExpiresAt datetime2(3) NOT NULL,
    Attempts int NOT NULL CONSTRAINT DF_OwnerOtpChallenges_Attempts DEFAULT 0,
    MaxAttempts int NOT NULL CONSTRAINT DF_OwnerOtpChallenges_MaxAttempts DEFAULT 5,
    ConsumedAt datetime2(3) NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_OwnerOtpChallenges_CreatedAt DEFAULT SYSUTCDATETIME(),
    ClientIpHash varbinary(32) NULL,
    CONSTRAINT CK_OwnerOtpChallenges_Purpose CHECK (Purpose IN ('register', 'login')),
    CONSTRAINT CK_OwnerOtpChallenges_Attempts CHECK (Attempts >= 0 AND MaxAttempts BETWEEN 1 AND 10)
  );
  CREATE INDEX IX_OwnerOtpChallenges_Mobile_Purpose_CreatedAt
    ON dbo.OwnerOtpChallenges(Mobile, Purpose, CreatedAt DESC)
    INCLUDE (ExpiresAt, Attempts, MaxAttempts, ConsumedAt);
END;

COMMIT TRANSACTION;
