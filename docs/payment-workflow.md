# Subscription payment workflow

## Current flow (manual transfer)

1. A business owner chooses an active paid plan on `/workspace/subscription2`.
2. The system creates a `PendingPayment` subscription and a `Pending` `PaymentTransactions` row with `Gateway = Manual`.
3. The owner uploads a JPG, PNG, WEBP, or PDF receipt (maximum 5 MB). The API verifies the file signature and stores the receipt in the central database.
4. A platform administrator reviews the receipt at `/payments`.
5. The administrator confirms the payment only after checking the transfer outside the application. The API requires a receipt for manual payments.
6. After confirmation, the same database transaction marks the payment `Paid` and activates the subscription now, or reserves it after the current active subscription ends.
7. If the payment is marked failed, the pending subscription is cancelled.

Uploading a receipt does not itself prove that money was received. Do not automatically activate a manual payment based only on an uploaded image. The automatic part is subscription activation after an authorized administrator confirms the receipt.

## Database migration

Review and run `docs/create-payment-receipts.sql` manually against the central SQL Server database before enabling receipt upload. The application does not run database migrations automatically.

## Online gateway (future; not enabled)

The customer UI shows an unavailable/disabled online-payment option. No gateway request or callback is made yet.

When a provider is selected:
- Add a dedicated gateway adapter and store secrets only in server-side environment variables.
- Create a unique payment reference before redirecting the customer.
- Verify the provider callback server-side (signature/token, amount, currency, merchant account, and payment reference) by calling the provider's verification API.
- Make callbacks idempotent and update payment plus subscription in one SQL transaction.
- Never mark a payment as paid from a browser redirect or client-submitted status.
- Keep `Gateway = Manual` for receipt-based transfers and use a provider-specific value for online transactions.
- Test success, failure, repeated callbacks, wrong amounts, expired payments, and interrupted callbacks in the provider sandbox before enabling the option.
