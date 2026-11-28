/* V29_20261127_UpdateServiceReminderMessageTemplate.sql | Canonical tenant migration managed by managerProject. */
/*
  Aligns the tenant RepairCompleted rule template with the current Repair event payload.
  Only MessageTemplate changes; delay, recurrence, timezone, provider and enabled state remain untouched.
*/
IF OBJECT_ID(N'notification.ReminderEventRules', N'U') IS NULL
    THROW 52901, 'notification.ReminderEventRules does not exist.', 1;

DECLARE @MessageTemplate NVARCHAR(2000) =
    N'سلام {{customerName}} عزیز، زمان سرویس دوره‌ای دستگاه شما فرا رسیده است. دستگاه: {{deviceType}} {{brand}} {{model}}. تعمیرگاه {{branchName}} - تماس: {{branchPhone}}';

DECLARE @RuleCount INT;
SELECT @RuleCount = COUNT(*)
FROM notification.ReminderEventRules
WHERE EventType = N'RepairCompleted'
  AND ReminderType = N'RepairCompletedFollowUp'
  AND SourceEntity = N'RepairOrder';

IF @RuleCount <> 1
    THROW 52902, 'Expected exactly one RepairCompletedFollowUp rule. No changes were made.', 1;

UPDATE notification.ReminderEventRules
SET MessageTemplate = @MessageTemplate,
    UpdatedAt = SYSUTCDATETIME()
WHERE EventType = N'RepairCompleted'
  AND ReminderType = N'RepairCompletedFollowUp'
  AND SourceEntity = N'RepairOrder';
