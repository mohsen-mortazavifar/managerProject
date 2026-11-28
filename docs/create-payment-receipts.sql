/*
  Run this script manually against the central Repair Master database.
  It is safe to run more than once.
  Receipt files are limited by the API to 5 MB.
*/
IF COL_LENGTH(N'dbo.PaymentTransactions', N'ReceiptData') IS NULL
  ALTER TABLE dbo.PaymentTransactions ADD ReceiptData VARBINARY(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.PaymentTransactions', N'ReceiptFileName') IS NULL
  ALTER TABLE dbo.PaymentTransactions ADD ReceiptFileName NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.PaymentTransactions', N'ReceiptContentType') IS NULL
  ALTER TABLE dbo.PaymentTransactions ADD ReceiptContentType NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.PaymentTransactions', N'ReceiptUploadedAt') IS NULL
  ALTER TABLE dbo.PaymentTransactions ADD ReceiptUploadedAt DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.PaymentTransactions', N'ReceiptNote') IS NULL
  ALTER TABLE dbo.PaymentTransactions ADD ReceiptNote NVARCHAR(500) NULL;
GO
