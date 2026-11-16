CREATE TABLE "outcomego_computer_network_policy" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "mode" TEXT NOT NULL DEFAULT 'lan',
  "rules" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outcomego_computer_network_policy_pkey" PRIMARY KEY ("id")
);
