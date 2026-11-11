-- Sebelum ada semantik "replace per snapshot", tabel menumpuk banyak snapshot.
-- Sisakan hanya snapshot terakhir per (platform, jendela waktu).
DELETE FROM social_trends t
WHERE t.id IN (
  WITH latest AS (
    SELECT platform, window_hours, max(captured_at) AS captured_at
    FROM social_trends
    GROUP BY platform, window_hours
  )
  SELECT s.id
  FROM social_trends s
  JOIN latest l
    ON l.platform = s.platform
   AND l.window_hours IS NOT DISTINCT FROM s.window_hours
  WHERE s.captured_at <> l.captured_at
);
