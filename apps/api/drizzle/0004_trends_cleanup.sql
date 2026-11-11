-- Snapshot Google Trends yang ditulis sebelum kolom `source_published_at` ada
-- tidak punya umur tren. TikTok/X tidak punya pubDate, jadi hanya Google yang
-- dibersihkan (adapter lain fallback ke captured_at).
-- Catatan: `platform::text` dipakai karena enum GOOGLE_TRENDS baru ditambahkan di
-- migrasi 0002 dan PostgreSQL melarang pemakaian nilainya di transaksi yang sama.
DELETE FROM social_trends
WHERE platform::text = 'GOOGLE_TRENDS' AND source_published_at IS NULL;
