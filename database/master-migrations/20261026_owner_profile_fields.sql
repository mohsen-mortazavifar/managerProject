/*
  Owner account profile fields:
  - stable username for owner sign-in
  - business address and landline
  - persist the same values on the OTP challenge until phone verification succeeds
*/
SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.Users', N'UserName') IS NULL
  ALTER TABLE dbo.Users ADD UserName NVARCHAR(100) NULL;
GO
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'UX_Users_UserName'
)
  CREATE UNIQUE INDEX UX_Users_UserName ON dbo.Users(UserName) WHERE UserName IS NOT NULL;
GO

IF COL_LENGTH(N'dbo.Tenants', N'BusinessAddress') IS NULL
  ALTER TABLE dbo.Tenants ADD BusinessAddress NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.Tenants', N'ContactPhone') IS NULL
  ALTER TABLE dbo.Tenants ADD ContactPhone NVARCHAR(30) NULL;
GO

IF COL_LENGTH(N'dbo.OwnerOtpChallenges', N'UserName') IS NULL
  ALTER TABLE dbo.OwnerOtpChallenges ADD UserName NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.OwnerOtpChallenges', N'BusinessAddress') IS NULL
  ALTER TABLE dbo.OwnerOtpChallenges ADD BusinessAddress NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.OwnerOtpChallenges', N'BusinessPhone') IS NULL
  ALTER TABLE dbo.OwnerOtpChallenges ADD BusinessPhone NVARCHAR(30) NULL;
GO
