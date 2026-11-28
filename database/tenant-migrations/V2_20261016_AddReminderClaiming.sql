/*
  Reminder worker claiming support.
  Apply once to the Repair SQL Server database before deploying the updated
  RepairReminderService. This script is idempotent and does not delete data.
*/
SET XACT_ABORT ON;

IF COL_LENGTH('repair.ServiceReminders', 'ProcessingAt') IS NULL
BEGIN
  ALTER TABLE repair.ServiceReminders
    ADD ProcessingAt DATETIME2(3) NULL;
END;

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_ServiceReminders_Status'
    AND parent_object_id = OBJECT_ID('repair.ServiceReminders')
)
BEGIN
  ALTER TABLE repair.ServiceReminders
    DROP CONSTRAINT CK_ServiceReminders_Status;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'CK_ServiceReminders_Status'
    AND parent_object_id = OBJECT_ID('repair.ServiceReminders')
)
BEGIN
  ALTER TABLE repair.ServiceReminders
    ADD CONSTRAINT CK_ServiceReminders_Status
    CHECK (Status IN ('Pending','Processing','Sent','Cancelled','Failed'));
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_ServiceReminders_ProcessingLease'
    AND object_id = OBJECT_ID('repair.ServiceReminders')
)
BEGIN
  CREATE INDEX IX_ServiceReminders_ProcessingLease
    ON repair.ServiceReminders(Status, ProcessingAt, ReminderAt)
    WHERE Status = 'Processing';
END;

