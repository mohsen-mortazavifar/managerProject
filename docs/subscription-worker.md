# Subscription status worker

The subscription worker owns time-based subscription transitions. The Next.js API must not mutate subscription statuses as a side effect of a GET request.

## What it does

- Marks `Active` subscriptions as `Expired` when `EndsAt <= SYSUTCDATETIME()`.
- Marks expired `Reserved` subscriptions as `Expired`.
- Activates at most one eligible `Reserved` subscription per tenant when its start time has arrived, its end time has not passed, and payment is confirmed (`PaymentTransactions.Status = 'Paid'`) or an approved free trial is recorded.
- Uses a SQL Server application lock so two worker instances do not perform the reconciliation concurrently.
- Polls every 60 seconds by default. Set `SUBSCRIPTION_WORKER_POLL_MS` to change the interval.

The worker does not mark a paid subscription as paid; payment confirmation remains the responsibility of the payment review/payment callback flow.

## Local run

Use the same SQL Server connection variables as the application in `.env.local`, then start the worker in a separate terminal:

```bash
npm run subscription:worker
```

Run a single reconciliation cycle for a manual check:

```bash
npm run subscription:worker -- --once
```

## Production deployment

Run the worker as a separate, continuously running background process on a server with access to the master SQL Server database. Do not rely on a Next.js page request or serverless function to keep it alive. Configure the process supervisor or Windows service/task management to start it on boot and restart it if it exits. Keep its environment variables and logs available to the operations team.

The worker uses `DB_NAME` if configured, otherwise `Repair_Master`. Ensure `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, and any required TLS settings match the production database.
