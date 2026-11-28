/*
  Repair Master — revoked JWT access tokens.
  Review and run manually against the application database before deploying
  the code that queries dbo.RevokedAccessTokens.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.RevokedAccessTokens', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.RevokedAccessTokens
  (
    TokenHash varbinary(32) NOT NULL
      CONSTRAINT PK_RevokedAccessTokens PRIMARY KEY,
    ExpiresAt datetime2(7) NOT NULL,
    RevokedAt datetime2(7) NOT NULL
      CONSTRAINT DF_RevokedAccessTokens_RevokedAt DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_RevokedAccessTokens_ExpiresAt
    ON dbo.RevokedAccessTokens (ExpiresAt);
END;

COMMIT TRANSACTION;
