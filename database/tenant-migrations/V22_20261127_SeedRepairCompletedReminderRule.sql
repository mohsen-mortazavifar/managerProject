/* V22_20261127_SeedRepairCompletedReminderRule.sql | Canonical tenant migration managed by managerProject. */
/*
  Seed the tenant-owned RepairCompleted follow-up rule.
  The migration engine owns the transaction; no explicit BEGIN/COMMIT here.
  Event values match Repair's current RepairCompleted payload contract.
*/
IF OBJECT_ID(N'notification.ReminderEventRules', N'U') IS NULL
    THROW 52201, 'notification.ReminderEventRules does not exist. Apply V21 first.', 1;

DECLARE @EventType NVARCHAR(100) = N'RepairCompleted';
DECLARE @ReminderType NVARCHAR(100) = N'RepairCompletedFollowUp';
DECLARE @SourceEntity NVARCHAR(100) = N'RepairOrder';
DECLARE @DelayMinutes INT = 4320;
DECLARE @TimeZoneId NVARCHAR(100) = N'Asia/Tehran';
DECLARE @MobileTemplate NVARCHAR(100) = N'{{customerMobile}}';
DECLARE @MessageTemplate NVARCHAR(2000) =
    N'سلام {{customerName}} عزیز، زمان سرویس دوره‌ای دستگاه شما فرا رسیده است. دستگاه: {{deviceType}} {{brand}} {{model}}. تعمیرگاه {{branchName}} - تماس: {{branchPhone}}';

DECLARE @ExistingCount INT;
SELECT @ExistingCount = COUNT(*)
FROM notification.ReminderEventRules WITH (UPDLOCK, HOLDLOCK)
WHERE EventType = @EventType
  AND ReminderType = @ReminderType
  AND SourceEntity = @SourceEntity;

IF @ExistingCount > 1
    THROW 52202, 'Duplicate RepairCompletedFollowUp rules exist. Resolve duplicates before migration.', 1;

IF @ExistingCount = 1
BEGIN
    UPDATE notification.ReminderEventRules
    SET DelayMinutes = @DelayMinutes,
        TimeZoneId = @TimeZoneId,
        MobileTemplate = @MobileTemplate,
        MessageTemplate = @MessageTemplate,
        ProviderCode = N'ParsGreen',
        RecurrenceIntervalValue = NULL,
        RecurrenceIntervalUnit = NULL,
        LocalTime = NULL,
        IsEnabled = 1,
        UpdatedAt = SYSUTCDATETIME()
    WHERE EventType = @EventType
      AND ReminderType = @ReminderType
      AND SourceEntity = @SourceEntity;
END
ELSE
BEGIN
    INSERT INTO notification.ReminderEventRules
    (
        EventType, ReminderType, SourceEntity, DelayMinutes, TimeZoneId,
        MobileTemplate, MessageTemplate, ProviderCode,
        RecurrenceIntervalValue, RecurrenceIntervalUnit, LocalTime, IsEnabled
    )
    VALUES
    (
        @EventType, @ReminderType, @SourceEntity, @DelayMinutes, @TimeZoneId,
        @MobileTemplate, @MessageTemplate, N'ParsGreen',
        NULL, NULL, NULL, 1
    );
END;

SELECT ReminderEventRuleId, EventType, ReminderType, SourceEntity,
       DelayMinutes, TimeZoneId, MobileTemplate, MessageTemplate,
       ProviderCode, IsEnabled, UpdatedAt
FROM notification.ReminderEventRules
WHERE EventType = @EventType
  AND ReminderType = @ReminderType
  AND SourceEntity = @SourceEntity;
