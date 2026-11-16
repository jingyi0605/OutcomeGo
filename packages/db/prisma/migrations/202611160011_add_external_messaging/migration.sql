-- External messaging (specs/009): binding, channel mapping, inbound receipt, outbound delivery.
-- Status vocabularies and lifecycle checks live in prisma/sql/raw-schema.sql, which Prisma applies after every push.

CREATE TABLE "outcomego_external_messaging_binding" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "botId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "inboundPolicy" TEXT NOT NULL DEFAULT 'owner_only',
  "status" TEXT NOT NULL DEFAULT 'active',
  "inboundCursor" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "retryAckCursor" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "retryFirstAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastPolledAt" TIMESTAMP(3),
  "lastAcceptedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "rejectedCounts" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_external_messaging_binding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_external_messaging_binding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "outcomego_plugin_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_messaging_binding_botId_fkey" FOREIGN KEY ("botId") REFERENCES "outcomego_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcomego_external_messaging_binding_connection_id_key" ON "outcomego_external_messaging_binding" ("connectionId");
CREATE INDEX "outcomego_external_messaging_binding_bot_id_idx" ON "outcomego_external_messaging_binding" ("botId");
CREATE INDEX "outcomego_external_messaging_binding_poll_idx" ON "outcomego_external_messaging_binding" ("enabled", "status", "leaseExpiresAt");

CREATE TABLE "outcomego_external_channel_mapping" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "botId" UUID NOT NULL,
  "peerId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "peerType" TEXT NOT NULL DEFAULT 'direct',
  "channelId" UUID NOT NULL,
  "displayName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastInboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_external_channel_mapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_external_channel_mapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "outcomego_plugin_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_channel_mapping_botId_fkey" FOREIGN KEY ("botId") REFERENCES "outcomego_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_channel_mapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "outcomego_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcomego_external_channel_mapping_channel_id_key" ON "outcomego_external_channel_mapping" ("channelId");
CREATE UNIQUE INDEX "outcomego_external_channel_mapping_identity_key" ON "outcomego_external_channel_mapping" ("connectionId", "peerId", "botId");
CREATE INDEX "outcomego_external_channel_mapping_bot_id_idx" ON "outcomego_external_channel_mapping" ("botId");

CREATE TABLE "outcomego_external_message_receipt" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "peerId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "rejectionCode" TEXT,
  "mappingId" UUID,
  "channelMessageId" UUID,
  "runId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outcomego_external_message_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_external_message_receipt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "outcomego_plugin_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_message_receipt_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "outcomego_external_channel_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_message_receipt_channelMessageId_fkey" FOREIGN KEY ("channelMessageId") REFERENCES "outcomego_channel_message"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_message_receipt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "outcomego_run"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcomego_external_message_receipt_provider_key" ON "outcomego_external_message_receipt" ("connectionId", "providerMessageId");
CREATE INDEX "outcomego_external_message_receipt_created_at_idx" ON "outcomego_external_message_receipt" ("createdAt");

CREATE TABLE "outcomego_external_outbound_delivery" (
  "id" UUID NOT NULL,
  "callId" TEXT NOT NULL,
  "connectionId" UUID NOT NULL,
  "mappingId" UUID,
  "botId" UUID NOT NULL,
  "runId" UUID,
  "channelMessageId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "providerResult" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "deliveryLeaseOwner" TEXT,
  "deliveryLeaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_external_outbound_delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outcomego_external_outbound_delivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "outcomego_plugin_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_outbound_delivery_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "outcomego_external_channel_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_outbound_delivery_botId_fkey" FOREIGN KEY ("botId") REFERENCES "outcomego_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_outbound_delivery_runId_fkey" FOREIGN KEY ("runId") REFERENCES "outcomego_run"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "outcomego_external_outbound_delivery_channelMessageId_fkey" FOREIGN KEY ("channelMessageId") REFERENCES "outcomego_channel_message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcomego_external_outbound_delivery_call_id_key" ON "outcomego_external_outbound_delivery" ("callId");
CREATE UNIQUE INDEX "outcomego_external_outbound_delivery_channel_message_id_key" ON "outcomego_external_outbound_delivery" ("channelMessageId");
CREATE INDEX "outcomego_external_outbound_delivery_recovery_idx" ON "outcomego_external_outbound_delivery" ("status", "deliveryLeaseExpiresAt");
CREATE INDEX "outcomego_external_outbound_delivery_mapping_idx" ON "outcomego_external_outbound_delivery" ("mappingId", "createdAt");
CREATE INDEX "outcomego_external_outbound_delivery_connection_idx" ON "outcomego_external_outbound_delivery" ("connectionId", "status");
