/*
  SSO authorization codes for the central Repair Master authentication service.
  Apply once to the central Repair_Master database before enabling the SSO endpoints.
*/
IF OBJECT_ID(N'dbo.SsoAuthorizationCodes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.SsoAuthorizationCodes
  (
    SsoAuthorizationCodeId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_SsoAuthorizationCodes PRIMARY KEY,
    CodeHash VARBINARY(32) NOT NULL,
    StateHash VARBINARY(32) NOT NULL,
    UserId BIGINT NOT NULL,
    TenantId BIGINT NOT NULL,
    ExpiresAt DATETIME2(3) NOT NULL,
    ConsumedAt DATETIME2(3) NULL,
    CreatedAt DATETIME2(3) NOT NULL
      CONSTRAINT DF_SsoAuthorizationCodes_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_SsoAuthorizationCodes_CodeHash UNIQUE (CodeHash)
  );

  CREATE INDEX IX_SsoAuthorizationCodes_ExpiresAt
    ON dbo.SsoAuthorizationCodes (ExpiresAt)
    INCLUDE (ConsumedAt);
END;
