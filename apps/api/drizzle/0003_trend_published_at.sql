-- Waktu publikasi tren menurut platform (Google: <pubDate> RSS, X: `as_of`).
-- Dipakai agar filter jendela 24 jam / 7 hari mengikuti umur tren, bukan umur snapshot.
ALTER TABLE social_trends
  ADD COLUMN IF NOT EXISTS source_published_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_social_trends_published
  ON social_trends (source_published_at DESC);
