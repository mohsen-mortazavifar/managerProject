/*
  Link concrete reminder instances to the tenant rule that created them.
  Apply after 20261115_add_tenant_reminder_rules.sql in every tenant database.

  DDL that references newly-added columns is executed dynamically. SQL Server
  compiles a complete batch before evaluating IF branches, so static ALTER /
  CREATE statements can otherwise fail with "Invalid column name".
*/
SET XACT_ABORT ON;

  IF OBJECT_ID(N'repair.ServiceReminders', N'U') IS NULL
    THROW 51000, 'Table repair.ServiceReminders does not exist.', 1;

  IF OBJECT_ID(N'notification.ReminderRules', N'U') IS NULL
    THROW 51001, 'Table notification.ReminderRules does not exist. Run 20261115_add_tenant_reminder_rules.sql first.', 1;

  IF COL_LENGTH(N'repair.ServiceReminders', N'ReminderRuleId') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE repair.ServiceReminders
      ADD ReminderRuleId BIGINT NULL;
    ';

  IF COL_LENGTH(N'repair.ServiceReminders', N'OccurrenceNumber') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE repair.ServiceReminders
      ADD OccurrenceNumber INT NOT NULL
        CONSTRAINT DF_ServiceReminders_OccurrenceNumber DEFAULT (1) WITH VALUES;
    ';

  IF COL_LENGTH(N'repair.ServiceReminders', N'SourceEventId') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE repair.ServiceReminders
      ADD SourceEventId UNIQUEIDENTIFIER NULL;
    ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name=N'FK_ServiceReminders_ReminderRules'
      AND parent_object_id=OBJECT_ID(N'repair.ServiceReminders')
  )
    EXEC sys.sp_executesql N'
      ALTER TABLE repair.ServiceReminders
      ADD CONSTRAINT FK_ServiceReminders_ReminderRules
      FOREIGN KEY (ReminderRuleId)
      REFERENCES notification.ReminderRules(ReminderRuleId);
    ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name=N'CK_ServiceReminders_OccurrenceNumber'
      AND parent_object_id=OBJECT_ID(N'repair.ServiceReminders')
  )
    EXEC sys.sp_executesql N'
      ALTER TABLE repair.ServiceReminders
      ADD CONSTRAINT CK_ServiceReminders_OccurrenceNumber
      CHECK (OccurrenceNumber >= 1);
    ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name=N'UX_ServiceReminders_RuleOccurrence'
      AND object_id=OBJECT_ID(N'repair.ServiceReminders')
  )
    EXEC sys.sp_executesql N'
      CREATE UNIQUE INDEX UX_ServiceReminders_RuleOccurrence
      ON repair.ServiceReminders(RepairOrderId, ReminderRuleId, OccurrenceNumber)
      WHERE ReminderRuleId IS NOT NULL;
    ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name=N'UX_ServiceReminders_SourceEventRule'
      AND object_id=OBJECT_ID(N'repair.ServiceReminders')
  )
    EXEC sys.sp_executesql N'
      CREATE UNIQUE INDEX UX_ServiceReminders_SourceEventRule
      ON repair.ServiceReminders(SourceEventId, ReminderRuleId)
      WHERE SourceEventId IS NOT NULL AND ReminderRuleId IS NOT NULL;
    ';

GO
