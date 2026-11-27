/* V27_20261127_AddSmsDeliveryLogs.sql | Canonical tenant migration managed by managerProject. */
/*
  Tenant-local SMS delivery history synchronized from central TaskFlow.
  Additive and safe for existing notification.SmsLogs tables.
*/
IF SCHEMA_ID(N'notification') IS NULL EXEC(N'CREATE SCHEMA notification');

IF OBJECT_ID(N'notification.SmsLogs', N'U') IS NULL
BEGIN
    CREATE TABLE notification.SmsLogs
    (
        SmsLogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantSmsLogs PRIMARY KEY,
        TemplateId BIGINT NULL,
        Mobile NVARCHAR(20) NOT NULL,
        Message NVARCHAR(2000) NOT NULL,
        Status NVARCHAR(50) NOT NULL,
        ProviderMessageId NVARCHAR(300) NULL,
        ErrorMessage NVARCHAR(2000) NULL,
        SentAt DATETIME2(3) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_TenantSmsLogs_CreatedAt DEFAULT(SYSUTCDATETIME())
    );
END;

IF COL_LENGTH(N'notification.SmsLogs', N'Status') IS NOT NULL
    ALTER TABLE notification.SmsLogs ALTER COLUMN Status NVARCHAR(50) NOT NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'ProviderMessageId') IS NOT NULL
    ALTER TABLE notification.SmsLogs ALTER COLUMN ProviderMessageId NVARCHAR(300) NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'ErrorMessage') IS NOT NULL
    ALTER TABLE notification.SmsLogs ALTER COLUMN ErrorMessage NVARCHAR(2000) NULL;

IF COL_LENGTH(N'notification.SmsLogs', N'TaskFlowSmsMessageId') IS NULL
    ALTER TABLE notification.SmsLogs ADD TaskFlowSmsMessageId BIGINT NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'TaskFlowSmsLogId') IS NULL
    ALTER TABLE notification.SmsLogs ADD TaskFlowSmsLogId BIGINT NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'EventType') IS NULL
    ALTER TABLE notification.SmsLogs ADD EventType NVARCHAR(50) NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'ProviderCode') IS NULL
    ALTER TABLE notification.SmsLogs ADD ProviderCode NVARCHAR(100) NULL;
IF COL_LENGTH(N'notification.SmsLogs', N'ProviderStatus') IS NULL
    ALTER TABLE notification.SmsLogs ADD ProviderStatus INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'notification.SmsLogs')
      AND name = N'UX_TenantSmsLogs_TaskFlowLog'
)
    CREATE UNIQUE INDEX UX_TenantSmsLogs_TaskFlowLog
        ON notification.SmsLogs(TaskFlowSmsLogId)
        WHERE TaskFlowSmsLogId IS NOT NULL;
