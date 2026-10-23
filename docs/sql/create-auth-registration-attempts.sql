USE Repair_Master;
GO

IF OBJECT_ID(N'dbo.AuthRegistrationAttempts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuthRegistrationAttempts
    (
        AuthRegistrationAttemptId BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_AuthRegistrationAttempts PRIMARY KEY,
        EmailHash VARBINARY(32) NOT NULL,
        IpHash VARBINARY(32) NULL,
        CreatedAt DATETIME2(3) NOT NULL
            CONSTRAINT DF_AuthRegistrationAttempts_CreatedAt DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_AuthRegistrationAttempts_Email_CreatedAt
        ON dbo.AuthRegistrationAttempts(EmailHash, CreatedAt);

    CREATE INDEX IX_AuthRegistrationAttempts_Ip_CreatedAt
        ON dbo.AuthRegistrationAttempts(IpHash, CreatedAt)
        WHERE IpHash IS NOT NULL;
END;
GO
