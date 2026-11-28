/*
  Tenant-scoped configurable reminder rules.
  Apply this script to each tenant database.
  Safe to run repeatedly; existing notification data is not modified.
*/
SET XACT_ABORT ON;

IF SCHEMA_ID(N'notification') IS NULL
  EXEC(N'CREATE SCHEMA notification');

IF OBJECT_ID(N'notification.ReminderRules', N'U') IS NULL
BEGIN
  CREATE TABLE notification.ReminderRules
  (
    ReminderRuleId BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_ReminderRules PRIMARY KEY,
    RuleCode NVARCHAR(100) NOT NULL,
    Title NVARCHAR(150) NOT NULL,
    TriggerEventCode NVARCHAR(100) NOT NULL,
    ServiceTypeCode NVARCHAR(100) NULL,
    DelayValue INT NOT NULL,
    DelayUnit NVARCHAR(20) NOT NULL,
    RepeatIntervalValue INT NULL,
    RepeatIntervalUnit NVARCHAR(20) NULL,
    MaxOccurrences INT NULL,
    TemplateCode NVARCHAR(50) NULL,
    CancelEventCode NVARCHAR(100) NULL,
    IsEnabled BIT NOT NULL
      CONSTRAINT DF_ReminderRules_IsEnabled DEFAULT (1),
    CreatedAt DATETIME2(3) NOT NULL
      CONSTRAINT DF_ReminderRules_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2(3) NULL,

    CONSTRAINT UQ_ReminderRules_RuleCode UNIQUE (RuleCode),
    CONSTRAINT CK_ReminderRules_DelayValue CHECK (DelayValue >= 0),
    CONSTRAINT CK_ReminderRules_DelayUnit
      CHECK (DelayUnit IN (N'Minute', N'Hour', N'Day', N'Month')),
    CONSTRAINT CK_ReminderRules_RepeatPair
      CHECK (
        (RepeatIntervalValue IS NULL AND RepeatIntervalUnit IS NULL)
        OR
        (RepeatIntervalValue IS NOT NULL AND RepeatIntervalValue > 0
          AND RepeatIntervalUnit IS NOT NULL
          AND RepeatIntervalUnit IN (N'Minute', N'Hour', N'Day', N'Month'))
      ),
    CONSTRAINT CK_ReminderRules_MaxOccurrences
      CHECK (MaxOccurrences IS NULL OR MaxOccurrences >= 1)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'notification.ReminderRules')
    AND name = N'IX_ReminderRules_Event_Enabled'
)
BEGIN
  CREATE INDEX IX_ReminderRules_Event_Enabled
    ON notification.ReminderRules(TriggerEventCode, IsEnabled, ServiceTypeCode)
    INCLUDE (DelayValue, DelayUnit, RepeatIntervalValue, RepeatIntervalUnit,
             MaxOccurrences, TemplateCode, CancelEventCode, RuleCode, Title);
END;

-- Preserve the previous two-day pickup reminder behavior as an editable tenant rule.
IF NOT EXISTS (
  SELECT 1 FROM notification.ReminderRules
  WHERE RuleCode=N'repair-ready-pickup'
)
BEGIN
  INSERT INTO notification.ReminderRules
  (
    RuleCode, Title, TriggerEventCode, ServiceTypeCode,
    DelayValue, DelayUnit, RepeatIntervalValue, RepeatIntervalUnit,
    MaxOccurrences, TemplateCode, CancelEventCode, IsEnabled
  )
  VALUES
  (
    N'repair-ready-pickup', N'یادآوری دریافت دستگاه تعمیرشده',
    N'RepairCompleted', NULL,
    2, N'Day', 2, N'Day',
    NULL, N'ServiceReminder', N'RepairDelivered', 1
  );
END;

GO
