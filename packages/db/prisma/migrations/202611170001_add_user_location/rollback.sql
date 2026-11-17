-- Disposable-copy rehearsal only: disable the feature and stop new location writes first.
-- Production rollback should keep this additive table and run the previous application.
DROP TABLE IF EXISTS "outcomego_user_location";
