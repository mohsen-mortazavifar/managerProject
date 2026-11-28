/* V17_20261122_AddReceiptTrackingLinkPreference.sql | Canonical tenant migration managed by managerProject. */
/*
  Stores whether the intake operator explicitly opted to include the public
  receipt tracking URL in the initial ReceiptCreated SMS.
  Existing receipts default to disabled; the tracking token remains available
  for the public page but is not sent unless this flag is enabled.
*/
IF COL_LENGTH(N'repair.Receipts', N'TrackingLinkEnabled') IS NULL
BEGIN
    ALTER TABLE repair.Receipts
    ADD TrackingLinkEnabled BIT NOT NULL
        CONSTRAINT DF_Receipts_TrackingLinkEnabled DEFAULT (0) WITH VALUES;
END;
GO
