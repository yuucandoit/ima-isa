-- Snapshot Google Trends yang ditulis sebelum kolom `source_published_at` ada
-- tidak punya umur tren. TikTok/X tidak punya pubDate, jadi hanya Google yang
-- dibersihkan (adapter lain fallback ke captured_at).
DELETE FROM social_trends
WHERE platform = 'GOOGLE_TRENDS' AND source_published_at IS NULL;
