-- Baris Google Trends lama (dari era RSS) tidak punya jendela waktu dan isinya
-- hanya 10 item; hapus supaya tidak bercampur dengan data halaman trending.
DELETE FROM social_trends
WHERE platform = 'GOOGLE_TRENDS' AND window_hours IS NULL;
