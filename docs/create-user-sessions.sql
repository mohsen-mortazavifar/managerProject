/*
  Repair Master — server-side authentication sessions
  ----------------------------------------------------
  Review this script, then run it manually against the central database.
  It creates only dbo.UserSessions. It does not alter existing tables/data.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.UserSessions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserSessions
  (
    SessionId bigint IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_UserSessions PRIMARY KEY,
    UserId nvarchar(128) NOT NULL,
    TokenHash varbinary(32) NOT NULL,
    ExpiresAt datetime2(7) NOT NULL,
    CreatedAt datetime2(7) NOT NULL
      CONSTRAINT DF_UserSessions_CreatedAt DEFAULT SYSUTCDATETIME(),
    RevokedAt datetime2(7) NULL,
    IpAddress nvarchar(45) NULL,
    UserAgent nvarchar(500) NULL,
    CONSTRAINT UQ_UserSessions_TokenHash UNIQUE (TokenHash)
  );

  CREATE INDEX IX_UserSessions_UserId_ExpiresAt
    ON dbo.UserSessions (UserId, ExpiresAt);
END;

COMMIT TRANSACTION;
