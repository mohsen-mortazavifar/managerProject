/*
  Link tenant-local Repair permission accounts to the canonical Master identity.
  Apply separately to each business database before enabling Master-backed authorization.
  Existing users and passwords are preserved; no automatic username-based linking is performed.
*/
SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'security.Users', N'MasterUserId') IS NULL
  ALTER TABLE security.Users ADD MasterUserId BIGINT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'security.Users')
    AND name = N'UX_security_Users_MasterUserId'
)
  CREATE UNIQUE INDEX UX_security_Users_MasterUserId
    ON security.Users(MasterUserId)
    WHERE MasterUserId IS NOT NULL;
GO
