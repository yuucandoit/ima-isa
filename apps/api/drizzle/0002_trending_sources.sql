DO $$ BEGIN
  ALTER TYPE source_platform ADD VALUE IF NOT EXISTS 'GOOGLE_TRENDS';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE social_trends
  ADD COLUMN IF NOT EXISTS trend_type   varchar(20)  NOT NULL DEFAULT 'trend',
  ADD COLUMN IF NOT EXISTS volume_label varchar(80),
  ADD COLUMN IF NOT EXISTS source_name  varchar(160),
  ADD COLUMN IF NOT EXISTS image_url    text;

CREATE INDEX IF NOT EXISTS idx_social_trends_captured_platform
  ON social_trends (platform, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_trends_type
  ON social_trends (trend_type);
