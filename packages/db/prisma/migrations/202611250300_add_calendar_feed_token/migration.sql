CREATE TABLE "outcomego_calendar_feed_token" (
    "id" UUID NOT NULL,
    "userId" TEXT,
    "name" VARCHAR(80) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "kinds" TEXT[] NOT NULL,
    "includeLinks" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    CONSTRAINT "outcomego_calendar_feed_token_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outcomego_calendar_feed_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "outcomego_user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "outcomego_calendar_feed_token_hash_key" ON "outcomego_calendar_feed_token"("tokenHash");
CREATE INDEX "outcomego_calendar_feed_owner_revoked_idx" ON "outcomego_calendar_feed_token"("userId", "revokedAt");
