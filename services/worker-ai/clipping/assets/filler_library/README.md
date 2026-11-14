# Filler Library

Stok video untuk mode **split-screen** (`renderMode: "split_screen"`).

Requirement:

- Rasio **9:16** (mis. 1080x1920) atau **1:1**, minimal 20 detik.
- **Tanpa audio** (audio klip utama yang dipakai) — kalau ada audio, worker
  tetap mengabaikannya karena hanya `[1:v]` yang diambil.
- Format `.mp4` / `.mov` / `.mkv` / `.webm`.

Konten yang umum dipakai: gameplay Subway Surfers/Minecraft, ASMR, satisfying
slime, kinetic sand, loop abstrak, atau footage stok bebas royalti.

Worker memilih satu berkas secara acak per render (`pick_filler`) dan mengambil
potongan mulai dari offset acak 0–25 detik. Bila folder kosong, renderer
memakai versi blur dari video utama sebagai pengganti agar klip tetap 9:16.

Tambahkan berkas di folder ini (tidak di-commit; lihat `.gitignore`).
