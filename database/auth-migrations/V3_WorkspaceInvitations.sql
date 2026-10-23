SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.WorkspaceInvitations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.WorkspaceInvitations (
    InvitationId uniqueidentifier NOT NULL CONSTRAINT PK_WorkspaceInvitations PRIMARY KEY,
    TokenHash varbinary(32) NOT NULL,
    TenantId bigint NOT NULL,
    RoleName nvarchar(200) NOT NULL,
    CreatedByUserId bigint NOT NULL,
    ExpiresAt datetime2(3) NOT NULL,
    AcceptedAt datetime2(3) NULL,
    RevokedAt datetime2(3) NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_WorkspaceInvitations_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX UX_WorkspaceInvitations_TokenHash ON dbo.WorkspaceInvitations(TokenHash);
  CREATE INDEX IX_WorkspaceInvitations_TenantId_CreatedAt ON dbo.WorkspaceInvitations(TenantId, CreatedAt DESC);
END;

IF OBJECT_ID('dbo.WorkspaceInviteOtpChallenges', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.WorkspaceInviteOtpChallenges (
    ChallengeId uniqueidentifier NOT NULL CONSTRAINT PK_WorkspaceInviteOtpChallenges PRIMARY KEY,
    InvitationId uniqueidentifier NOT NULL,
    Mobile nvarchar(40) NOT NULL,
    FullName nvarchar(200) NOT NULL,
    OtpHash varbinary(32) NOT NULL,
    ExpiresAt datetime2(3) NOT NULL,
    Attempts int NOT NULL CONSTRAINT DF_WorkspaceInviteOtpChallenges_Attempts DEFAULT 0,
    MaxAttempts int NOT NULL CONSTRAINT DF_WorkspaceInviteOtpChallenges_MaxAttempts DEFAULT 5,
    ConsumedAt datetime2(3) NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_WorkspaceInviteOtpChallenges_CreatedAt DEFAULT SYSUTCDATETIME(),
    ClientIpHash varbinary(32) NULL,
    CONSTRAINT CK_WorkspaceInviteOtpChallenges_Attempts CHECK (Attempts >= 0 AND MaxAttempts BETWEEN 1 AND 10)
  );
  CREATE INDEX IX_WorkspaceInviteOtpChallenges_Mobile_CreatedAt ON dbo.WorkspaceInviteOtpChallenges(Mobile, CreatedAt DESC);
END;

COMMIT TRANSACTION;
