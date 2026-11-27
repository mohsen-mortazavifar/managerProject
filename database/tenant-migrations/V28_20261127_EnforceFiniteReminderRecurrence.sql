/* V28_20261127_EnforceFiniteReminderRecurrence.sql | Canonical tenant migration managed by managerProject. */
/*
  Require finite occurrence counts for recurring tenant reminders.
  Legacy recurring rules/schedules without a cap receive a finite default of 12.
*/
SET XACT_ABORT ON;

IF OBJECT_ID(N'notification.ReminderEventRules', N'U') IS NULL
    THROW 52801, 'notification.ReminderEventRules does not exist.', 1;
IF OBJECT_ID(N'notification.ReminderSchedules', N'U') IS NULL
    THROW 52802, 'notification.ReminderSchedules does not exist.', 1;

UPDATE notification.ReminderEventRules
SET MaxOccurrences = 12, UpdatedAt = SYSUTCDATETIME()
WHERE RecurrenceIntervalValue IS NOT NULL
  AND RecurrenceIntervalUnit IS NOT NULL
  AND MaxOccurrences IS NULL;

UPDATE notification.ReminderSchedules
SET RuleJson = JSON_MODIFY(RuleJson, '$.maxOccurrences', 12),
    UpdatedAt = SYSUTCDATETIME()
WHERE TRY_CONVERT(INT, JSON_VALUE(RuleJson, '$.intervalValue')) IS NOT NULL
  AND JSON_VALUE(RuleJson, '$.maxOccurrences') IS NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'notification.ReminderEventRules')
      AND name = N'CK_ReminderEventRules_RecurrenceRequiresFiniteMax'
)
    ALTER TABLE notification.ReminderEventRules
    ADD CONSTRAINT CK_ReminderEventRules_RecurrenceRequiresFiniteMax CHECK (
        (RecurrenceIntervalValue IS NULL AND RecurrenceIntervalUnit IS NULL)
        OR (RecurrenceIntervalValue IS NOT NULL AND RecurrenceIntervalUnit IS NOT NULL
            AND MaxOccurrences IS NOT NULL AND MaxOccurrences BETWEEN 1 AND 1000)
    );
