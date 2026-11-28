/* V30_20261127_AddRepairSmsTemplatesAndBranchContacts.sql | Canonical tenant migration managed by managerProject. */
/*
  Repair tenant SMS template updates:
  - create Delivered when missing;
  - add branch placeholders to tenant-owned templates if missing;
  - preserve existing wording and activation state.
*/
IF OBJECT_ID(N'notification.SmsTemplates', N'U') IS NULL
    THROW 53001, 'notification.SmsTemplates does not exist.', 1;

IF NOT EXISTS (SELECT 1 FROM notification.SmsTemplates WHERE Code = N'Delivered')
BEGIN
    INSERT INTO notification.SmsTemplates (Code, Title, Body, IsActive)
    VALUES (
        N'Delivered',
        N'تحویل دستگاه به مشتری',
        N'{{CustomerName}} عزیز، دستگاه {{DeviceType}} {{Brand}} {{Model}} به شما تحویل داده شد. از اعتماد شما سپاسگزاریم.',
        1
    );
END;

UPDATE template
SET Body = CONCAT(
        COALESCE(RTRIM(template.Body), N''),
        CASE WHEN CHARINDEX(N'{{BranchName}}', COALESCE(template.Body, N'')) = 0
             THEN NCHAR(13) + NCHAR(10) + N'نام فروشگاه: {{BranchName}}' ELSE N'' END,
        CASE WHEN CHARINDEX(N'{{BranchPhone}}', COALESCE(template.Body, N'')) = 0
             THEN NCHAR(13) + NCHAR(10) + N'شماره تماس: {{BranchPhone}}' ELSE N'' END
    ),
    UpdatedAt = SYSUTCDATETIME()
FROM notification.SmsTemplates AS template
WHERE template.Code IN (N'ReceiptCreated', N'RepairCompleted', N'Delivered', N'ServiceReminder')
  AND (
      CHARINDEX(N'{{BranchName}}', COALESCE(template.Body, N'')) = 0
      OR CHARINDEX(N'{{BranchPhone}}', COALESCE(template.Body, N'')) = 0
  );
