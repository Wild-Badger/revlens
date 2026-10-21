ALTER TABLE plans ALTER COLUMN base_price DROP NOT NULL, ALTER COLUMN seat_price DROP NOT NULL;
ALTER TABLE dataset_metadata
  ADD COLUMN source_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN source_name TEXT NOT NULL DEFAULT 'Local dataset',
  ADD COLUMN history_start DATE,
  ADD COLUMN history_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN analytics_revision INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN pipeline_status TEXT NOT NULL DEFAULT 'pending';
