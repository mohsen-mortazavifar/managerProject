/*
  Master database migration:
  Stores per-tenant SQL Server login metadata and an AES-256-GCM encrypted password.
  Run once against Repair_Master (or the configured Master database) before deploying
  the updated provisioning worker. Keep the encryption key outside SQL Server.
*/
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.TenantDatabases', N'U') IS NULL
    THROW 51010, 'dbo.TenantDatabases does not exist. Apply the Master tenant schema first.', 1;
GO

IF COL_LENGTH(N'dbo.TenantDatabases', N'SqlLoginName') IS NULL
    ALTER TABLE dbo.TenantDatabases ADD SqlLoginName NVARCHAR(128) NULL;
GO

IF COL_LENGTH(N'dbo.TenantDatabases', N'SqlPasswordEncrypted') IS NULL
    ALTER TABLE dbo.TenantDatabases ADD SqlPasswordEncrypted NVARCHAR(1024) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TenantDatabases')
      AND name = N'UX_TenantDatabases_SqlLoginName'
)
    CREATE UNIQUE INDEX UX_TenantDatabases_SqlLoginName
        ON dbo.TenantDatabases(SqlLoginName)
        WHERE SqlLoginName IS NOT NULL;
GO
