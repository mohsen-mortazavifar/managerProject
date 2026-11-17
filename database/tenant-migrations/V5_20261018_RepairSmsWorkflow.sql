/*
  Seed the dedicated repair-completed SMS template.
  Safe to run more than once. Existing customized templates are preserved.
*/
IF OBJECT_ID(N'notification.SmsTemplates', N'U') IS NULL
  THROW 51110, 'notification.SmsTemplates must exist before this script is applied.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM notification.SmsTemplates WHERE Code=N'RepairCompleted')
BEGIN
  INSERT INTO notification.SmsTemplates (Code, Title, Body, IsActive)
  VALUES (
    N'RepairCompleted',
    N'تعمیر دستگاه انجام شد',
    N'سلام {{CustomerName}} عزیز، تعمیر دستگاه {{DeviceType}} {{Brand}} {{Model}} انجام شد. کد پیگیری: {{TrackingToken}}',
    1
  );
END;
GO
