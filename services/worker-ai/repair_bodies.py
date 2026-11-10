"""Reparasi `clean_content` yang tercemar JS/CSS (sisa fallback extractor lama).

Fallback extractor versi lama men-strip tag HTML sebelum membuang blok
`<script>`/`<style>`, sehingga isi inline JS (`window.process={...}`) dan CSS
styled-components ikut tersimpan sebagai badan artikel. Skrip ini mengambil
baris yang terindikasi tercemar, mengambil ulang halaman aslinya, lalu menulis
badan artikel yang bersih.

Pemakaian:
    python repair_bodies.py --limit 200 --dry-run
    python repair_bodies.py --limit 200

Catatan: embedding tidak dihitung ulang di sini. Jalankan
`python -m ...`/worker embedding ulang bila butuh vektor yang konsisten.
"""

from __future__ import annotations

import argparse
import logging

import db
from scrapers.extractor import extract_article, looks_like_code

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("repair_bodies")

CANDIDATE_SQL = """
SELECT id, url, title, clean_content
FROM media_items
WHERE platform = 'NEWS_MEDIA'
  AND url <> ''
  AND (clean_content ~ '(window\\.[A-Za-z_$]|!important|@media|/\\*!|function\\s*\\()'
       OR clean_content ~ '[{};]{3,}')
ORDER BY published_at DESC
LIMIT %s
"""

UPDATE_SQL = "UPDATE media_items SET clean_content = %s WHERE id = %s"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200, help="maksimum baris yang diperiksa")
    parser.add_argument("--dry-run", action="store_true", help="jangan tulis perubahan")
    args = parser.parse_args()

    with db.cursor() as cur:
        cur.execute(CANDIDATE_SQL, (args.limit,))
        rows = cur.fetchall()

    logger.info("%d kandidat tercemar diperiksa", len(rows))
    repaired = skipped = failed = 0

    for row in rows:
        if not looks_like_code(row["clean_content"]):
            skipped += 1
            continue
        extracted = extract_article(row["url"])
        text = str(extracted.get("text") or "")
        if len(text) < 240 or looks_like_code(text):
            failed += 1
            logger.warning("gagal mengekstrak ulang: %s", row["url"])
            continue
        logger.info("perbaiki %s (%d → %d karakter)", row["title"][:60], len(row["clean_content"]), len(text))
        if not args.dry_run:
            with db.cursor() as cur:
                cur.execute(UPDATE_SQL, (text, row["id"]))
        repaired += 1

    logger.info(
        "selesai: %d diperbaiki, %d dilewati, %d gagal%s",
        repaired,
        skipped,
        failed,
        " (dry-run)" if args.dry_run else "",
    )


if __name__ == "__main__":
    main()
