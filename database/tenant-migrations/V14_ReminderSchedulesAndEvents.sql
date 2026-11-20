/*
  V14 - Tenant reminder schedules and event inbox

  Tenant-owned reminder definitions are synchronized to the central database
  by TenantReminderSyncService. The central TenantReminderSyncState table and
  central ReminderSchedules projection are intentionally not created here.
*/

IF OBJECT_ID(N'dbo.ReminderSchedules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReminderSchedules
    (
        ReminderScheduleId BIGINT IDENTITY(1,1) NOT NULL,
        ReminderType NVARCHAR(200) NOT NULL,
        SourceEntity NVARCHAR(200) NOT NULL,
        SourceEntityId BIGINT NOT NULL,
        RuleJson NVARCHAR(MAX) NOT NULL,
        TimeZoneId NVARCHAR(200) NOT NULL,
        ScheduleVersion INT NOT NULL
            CONSTRAINT DF_TenantReminderSchedules_ScheduleVersion DEFAULT (1),
        IsEnabled BIT NOT NULL
            CONSTRAINT DF_TenantReminderSchedules_IsEnabled DEFAULT (1),
        NextRunAtUtc DATETIME2(7) NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_TenantReminderSchedules_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_TenantReminderSchedules_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_TenantReminderSchedules
            PRIMARY KEY CLUSTERED (ReminderScheduleId)
    );
END;
GO

IF OBJECT_ID(N'dbo.ReminderSchedules', N'U') IS NULL
    THROW 51401, 'TENANT_REMINDER_SCHEDULES_TABLE_CREATION_FAILED.', 1;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.ReminderSchedules')
      AND name = N'IX_TenantReminderSchedules_Updated'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TenantReminderSchedules_Updated
        ON dbo.ReminderSchedules (UpdatedAt, ReminderScheduleId)
        INCLUDE (IsEnabled, NextRunAtUtc, ScheduleVersion);
END;
GO

IF OBJECT_ID(N'dbo.ReminderEventInbox', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReminderEventInbox
    (
        ReminderEventInboxId BIGINT IDENTITY(1,1) NOT NULL,
        EventId UNIQUEIDENTIFIER NOT NULL,
        EventType NVARCHAR(200) NOT NULL,
        SourceEntity NVARCHAR(200) NULL,
        SourceEntityId BIGINT NULL,
        OccurredAtUtc DATETIME2(7) NOT NULL,
        Status TINYINT NOT NULL
            CONSTRAINT DF_ReminderEventInbox_Status DEFAULT (0),
        CreatedReminderCount INT NOT NULL
            CONSTRAINT DF_ReminderEventInbox_CreatedReminderCount DEFAULT (0),
        ReceivedAtUtc DATETIME2(7) NOT NULL
            CONSTRAINT DF_ReminderEventInbox_ReceivedAtUtc DEFAULT (SYSUTCDATETIME()),
        ProcessedAtUtc DATETIME2(7) NULL,
        CONSTRAINT PK_ReminderEventInbox
            PRIMARY KEY CLUSTERED (ReminderEventInboxId)
    );
END;
GO

IF OBJECT_ID(N'dbo.ReminderEventInbox', N'U') IS NULL
    THROW 51402, 'TENANT_REMINDER_EVENT_INBOX_TABLE_CREATION_FAILED.', 1;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.ReminderEventInbox')
      AND name = N'UQ_ReminderEventInbox_EventId'
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_ReminderEventInbox_EventId
        ON dbo.ReminderEventInbox (EventId);
END;
GO
