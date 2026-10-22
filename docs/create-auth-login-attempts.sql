/*
  Repair Master — persistent login rate limiting
  Review and run manually against the central SQL Server database.
  This script creates a new table; it does not alter existing tables.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.AuthLoginAttempts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthLoginAttempts
  (
    AuthLoginAttemptId bigint IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_AuthLoginAttempts PRIMARY KEY,
    EmailHash varbinary(32) NOT NULL,
    IpHash varbinary(32) NULL,
    Succeeded bit NOT NULL,
    UserAgent nvarchar(500) NULL,
    CreatedAt datetime2(7) NOT NULL
      CONSTRAINT DF_AuthLoginAttempts_CreatedAt DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_AuthLoginAttempts_EmailHash_CreatedAt
    ON dbo.AuthLoginAttempts (EmailHash, CreatedAt)
    INCLUDE (Succeeded);

  CREATE INDEX IX_AuthLoginAttempts_IpHash_CreatedAt
    ON dbo.AuthLoginAttempts (IpHash, CreatedAt)
    INCLUDE (Succeeded);
END;

COMMIT TRANSACTION;
