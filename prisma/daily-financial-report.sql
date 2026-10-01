-- Apply once to the PostgreSQL database used by Vercel before enabling the cron.
CREATE TABLE IF NOT EXISTS "DailyFinancialReport" (
  "date" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "errorMsg" TEXT,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sendingAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastResentAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
