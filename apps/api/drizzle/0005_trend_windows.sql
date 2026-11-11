-- Google Trends "Trending Now" punya beberapa jendela waktu (4/24/48/168 jam)
-- dan tiap tren membawa query terkait + jumlah berita.
ALTER TABLE social_trends
  ADD COLUMN IF NOT EXISTS window_hours integer,
  ADD COLUMN IF NOT EXISTS related_queries jsonb,
  ADD COLUMN IF NOT EXISTS news_count integer;

CREATE INDEX IF NOT EXISTS idx_social_trends_window
  ON social_trends (platform, window_hours, captured_at DESC);
