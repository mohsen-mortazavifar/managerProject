/* V25_20261127_AddOrderSelectedServiceReminderDelay.sql | Canonical tenant migration managed by managerProject. */
/*
  Use the reminder interval explicitly selected on each repair order.
  This is a one-time calendar-month delay (3, 6 or 12 months).
  Existing schedules for the previous fixed-delay rule are invalidated.
*/
SET XACT_ABORT ON;

IF OBJECT_ID(N'notification.ReminderEventRules', N'U') IS NULL
    THROW 52501, 'notification.ReminderEventRules does not exist.', 1;
IF OBJECT_ID(N'notification.ReminderSchedules', N'U') IS NULL
    THROW 52502, 'notification.ReminderSchedules does not exist. Apply V24 first.', 1;

IF COL_LENGTH(N'notification.ReminderEventRules', N'DelayDataKey') IS NULL
    ALTER TABLE notification.ReminderEventRules ADD DelayDataKey NVARCHAR(100) NULL;
IF COL_LENGTH(N'notification.ReminderEventRules', N'DelayUnit') IS NULL
    ALTER TABLE notification.ReminderEventRules ADD DelayUnit NVARCHAR(10) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'notification.ReminderEventRules')
      AND name = N'CK_ReminderEventRules_DynamicDelay'
)
    ALTER TABLE notification.ReminderEventRules
    ADD CONSTRAINT CK_ReminderEventRules_DynamicDelay CHECK (
        (DelayDataKey IS NULL AND DelayUnit IS NULL)
        OR (DelayDataKey IS NOT NULL AND DelayUnit = N'month')
    );

DECLARE @RuleCount INT;
SELECT @RuleCount = COUNT(*)
FROM notification.ReminderEventRules
WHERE EventType = N'RepairCompleted'
  AND ReminderType = N'RepairCompletedFollowUp'
  AND SourceEntity = N'RepairOrder';

IF @RuleCount <> 1
    THROW 52503, 'Expected exactly one RepairCompletedFollowUp rule.', 1;

UPDATE notification.ReminderEventRules
SET DelayMinutes = 0,
    DelayDataKey = N'serviceReminderIntervalMonths',
    DelayUnit = N'month',
    RecurrenceIntervalValue = NULL,
    RecurrenceIntervalUnit = NULL,
    MaxOccurrences = 1,
    CancelEventType = N'RepairStatusChanged,RepairDelivered,RepairCancelled',
    UpdatedAt = SYSUTCDATETIME()
WHERE EventType = N'RepairCompleted'
  AND ReminderType = N'RepairCompletedFollowUp'
  AND SourceEntity = N'RepairOrder';

UPDATE schedule
SET IsEnabled = 0,
    NextRunAtUtc = NULL,
    ScheduleVersion = ScheduleVersion + 1,
    UpdatedAt = SYSUTCDATETIME()
FROM notification.ReminderSchedules AS schedule
WHERE schedule.IsEnabled = 1
  AND (
      JSON_VALUE(schedule.RuleJson, '$.ruleId') IN (
          SELECT CONVERT(NVARCHAR(20), ReminderEventRuleId)
          FROM notification.ReminderEventRules
          WHERE EventType = N'RepairCompleted'
            AND ReminderType = N'RepairCompletedFollowUp'
            AND SourceEntity = N'RepairOrder'
      )
      OR (
          JSON_VALUE(schedule.RuleJson, '$.ruleId') IS NULL
          AND schedule.ReminderType = N'RepairCompletedFollowUp'
          AND schedule.SourceEntity = N'RepairOrder'
      )
  );
