/*
  Adds a customer type for individual and company records.

  Legacy intake records that stored "آقا" or "خانم" in FirstName are
  migrated to CustomerType. Their FirstName is cleared because the old
  intake UI used that column for gender instead of the person's actual name.
*/
IF COL_LENGTH(N'crm.Customers', N'CustomerType') IS NULL
BEGIN
    ALTER TABLE crm.Customers
    ADD CustomerType NVARCHAR(10) NULL;
END;
GO

UPDATE crm.Customers
SET CustomerType = FirstName,
    FirstName = N'',
    UpdatedAt = SYSUTCDATETIME()
WHERE CustomerType IS NULL
  AND FirstName IN (N'آقا', N'خانم');
GO
