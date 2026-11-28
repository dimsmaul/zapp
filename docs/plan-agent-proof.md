# Rencana: "agent testing as proof"

Catatan internal untuk tim Zapp. Status: **ide, belum divalidasi**. Tanggal: 28 November 2026.

## Intinya

Zapp sekarang merekam bug yang ditemukan **manusia**. Arah baru: Zapp menjadi tempat **bukti** dari pekerjaan **agent AI**. Agent menjalankan browser lewat Playwright, dan hasilnya satu laporan Zapp: video, langkah, console, network, dan info perangkat. Reviewer menontonnya dalam 30 detik.

Kalimat jual yang diuji: *"Setiap perubahan dari agent datang dengan bukti yang bisa ditonton."*

## Kenapa mungkin berhasil

- Agent AI menulis kode, tapi reviewer sulit memercayainya. "Tests passed" hanya teks. Video dengan log lebih meyakinkan.
- Sebagian besar sudah ada: video, console, network, laporan yang bisa dibagikan, folder, komentar bertanda waktu, dan MCP supaya agent *membaca* laporan. Yang baru: agent *menulis* laporan.
- Ruang di antara "bug report dari manusia" (Jam) dan "Playwright trace untuk developer" belum jelas dipegang siapa pun. Perlu dicek ulang sebelum membangun.

## Pembeda yang bisa dipertahankan

1. **Satu timeline** untuk bukti dari manusia (extension) dan dari agent (Playwright).
2. **Self-host.** Banyak tim tidak mau video aplikasi internalnya naik ke cloud orang lain. Sudah ada.
3. Tanda **pass/fail** yang jelas, alasan tiap langkah dari agent, dan ringkasan kegagalan oleh AI.

## Pembeli (hipotesis, perlu divalidasi)

| Pembeli | Kebutuhan | Cara bayar |
|---|---|---|
| Tim dev yang memakai agent untuk PR | Bukti di PR supaya reviewer percaya | Per tim atau per seat |
| Tim QA | Bukti regresi yang bisa dibagikan | Per seat |
| Agensi | Bukti pengiriman untuk klien | Per proyek |

Belum diputuskan siapa yang pertama. Itu menentukan urutan langkah di bawah.

## Urutan pembangunan

Tiap langkah dianggap selesai kalau kriteria di sampingnya terpenuhi.

1. **Reporter Playwright** (`@zapp/playwright`). Test apa pun mengunggah video, trace, console, dan network ke Zapp.
   Selesai kalau: satu perintah di CI menghasilkan laporan Zapp yang bisa dibuka dengan video dan log.
2. **Tool MCP untuk agent** (`start`, `step`, `finish`). Agent menjalankan browser dan menulis laporan beserta alasan tiap langkah.
   Selesai kalau: Claude Code atau Cursor membuat laporan Zapp dari satu tugas tanpa bantuan manual.
3. **Komentar otomatis di PR GitHub** berisi link atau GIF bukti.
   Selesai kalau: PR yang dibuat agent otomatis memuat bukti.
4. **Aplikasi desktop** sebagai "agent browser" siap pakai untuk orang non-teknis. Terakhir, karena paling mahal.

## Catatan aplikasi desktop

- **Tauri v2, tray-only.** Window dibuat saat perlu lalu dihancurkan (`close()`, bukan `hide()`), supaya tanpa window hanya proses Rust yang hidup.
- **Rekam dan encode di Rust**, bukan di webview: ScreenCaptureKit (macOS), Windows Graphics Capture, PipeWire (Linux), encoder hardware lewat ffmpeg atau GStreamer, tulis ke disk bertahap.
- **Dashboard tetap di web.** Aplikasi hanya recorder, dibuka di browser bawaan untuk melihat laporan.
- **Login lewat deep link** `zapp://auth?...`, dengan pola yang sama seperti login extension. Server sudah punya `extension-session`.
- **Upload** dengan stream dari disk ke `PUT /api/v1/captures/{id}/upload/capture`.
- **Browser bawaan** (Chromium) menambah ratusan MB. Pertimbangkan memakai browser yang sudah ada di mesin pengguna lebih dulu.
- **Biaya sebenarnya bukan RAM:** tiga backend capture, izin per OS, dan signing (Apple Developer $99 per tahun dengan notarization, code signing Windows).
- **Log console dan network tidak bisa diambil dari aplikasi desktop** untuk tab browser biasa. Itu hanya bisa lewat extension atau Playwright.

## Risiko

- Area ini ramai. Alat pengujian dan observabilitas yang mendekati sudah ada. Periksa pesaing terdekat dulu.
- Pembeli belum jelas. Tiap pembeli butuh fitur dan harga yang berbeda.
- Aplikasi desktop mahal dan mungkin tidak dibutuhkan kalau agent berjalan di terminal atau CI.

## Validasi sebelum membangun banyak

- Bicara dengan 5 sampai 10 tim yang sudah memakai agent untuk PR. Tanyakan apa yang mereka pakai sebagai bukti hari ini, dan apakah mereka mau membayar untuk bukti yang lebih baik.
- Buat prototipe langkah 1 dalam beberapa hari dan tunjukkan ke mereka, sebelum membangun langkah 2 sampai 4.

## Pertanyaan terbuka

- Pembeli pertama: tim dev, QA, atau agensi?
- Harga: per seat, per tim, atau per jumlah laporan?
- Apakah laporan dari agent dan dari manusia perlu dibedakan di UI, atau digabung?
- Berapa lama video agent disimpan, dan siapa yang memutuskan?
