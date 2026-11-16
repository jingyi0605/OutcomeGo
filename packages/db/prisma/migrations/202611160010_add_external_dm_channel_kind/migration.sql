-- Provider-independent conversation with an external messaging account (specs/009).
-- The value is added in its own migration: a new enum value cannot be used until the
-- transaction that adds it commits.
ALTER TYPE "outcomego_channel_kind" ADD VALUE IF NOT EXISTS 'external_dm';
