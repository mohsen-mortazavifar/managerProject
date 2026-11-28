/* V20_20261125_AddOrderServiceReminderPreferences.sql | Canonical tenant migration managed by managerProject. */
/*
  Per-repair-order opt-in follow-up reminder preference.
  Apply to each tenant operational database before deploying the matching Repair app.
  Existing orders remain opted out; no historical reminders are created.
*/
SET XACT_ABORT ON;

IF COL_LENGTH(N'repair.RepairOrders', N'ServiceReminderEnabled') IS NULL
BEGIN
  ALTER TABLE repair.RepairOrders
    ADD ServiceReminderEnabled BIT NOT NULL
      CONSTRAINT DF_RepairOrders_ServiceReminderEnabled DEFAULT (0) WITH VALUES;
END;
GO

IF COL_LENGTH(N'repair.RepairOrders', N'ServiceReminderIntervalMonths') IS NULL
BEGIN
  ALTER TABLE repair.RepairOrders
    ADD ServiceReminderIntervalMonths TINYINT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'repair.RepairOrders')
    AND name = N'CK_RepairOrders_ServiceReminderIntervalMonths'
)
BEGIN
  ALTER TABLE repair.RepairOrders
    ADD CONSTRAINT CK_RepairOrders_ServiceReminderIntervalMonths
    CHECK (
      (ServiceReminderEnabled = 0 AND ServiceReminderIntervalMonths IS NULL)
      OR
      (ServiceReminderEnabled = 1 AND ServiceReminderIntervalMonths IN (3, 6, 12))
    );
END;
GO
