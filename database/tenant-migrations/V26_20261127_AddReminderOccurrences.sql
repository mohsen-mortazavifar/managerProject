/* V26_20261127_AddReminderOccurrences.sql | Canonical tenant migration managed by managerProject. */
/*
  Tenant-owned reminder occurrences and occurrence count.
  Requires V24 ReminderSchedules and V25 tenant reminder event setup.
*/
IF OBJECT_ID(N'notification.ReminderSchedules', N'U') IS NULL
    THROW 52601, 'notification.ReminderSchedules does not exist. Apply V24 first.', 1;

IF COL_LENGTH(N'notification.ReminderSchedules', N'OccurrenceCount') IS NULL
    ALTER TABLE notification.ReminderSchedules ADD OccurrenceCount INT NOT NULL
        CONSTRAINT DF_TenantReminderSchedules_OccurrenceCount DEFAULT (0) WITH VALUES;

IF OBJECT_ID(N'notification.ReminderOccurrences', N'U') IS NULL
BEGIN
    CREATE TABLE notification.ReminderOccurrences
    (
        ReminderOccurrenceId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantReminderOccurrences PRIMARY KEY,
        ReminderScheduleId BIGINT NOT NULL,
        ScheduleVersion INT NOT NULL,
        DueAtUtc DATETIME2(3) NOT NULL,
        Status TINYINT NOT NULL CONSTRAINT DF_TenantReminderOccurrences_Status DEFAULT (0),
        ExecutionEventId UNIQUEIDENTIFIER NOT NULL,
        SmsMessageId BIGINT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_TenantReminderOccurrences_Created DEFAULT (SYSUTCDATETIME()),
        ExecutedAtUtc DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        CONSTRAINT FK_TenantReminderOccurrences_Schedule FOREIGN KEY(ReminderScheduleId)
            REFERENCES notification.ReminderSchedules(ReminderScheduleId),
        CONSTRAINT UQ_TenantReminderOccurrences_Due UNIQUE(ReminderScheduleId, ScheduleVersion, DueAtUtc),
        CONSTRAINT UQ_TenantReminderOccurrences_Event UNIQUE(ExecutionEventId),
        CONSTRAINT CK_TenantReminderOccurrences_Status CHECK(Status BETWEEN 0 AND 5),
        CONSTRAINT CK_TenantReminderOccurrences_Version CHECK(ScheduleVersion >= 1)
    );
    CREATE INDEX IX_TenantReminderOccurrences_Status_Due
        ON notification.ReminderOccurrences(Status, DueAtUtc, ReminderOccurrenceId)
        INCLUDE(ReminderScheduleId, ScheduleVersion, ExecutionEventId, SmsMessageId);
END;
