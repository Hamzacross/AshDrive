# AshDrive

AshDrive watches for your flash / USB drives and backs them up automatically — on **Windows** and **macOS**.

When you plug in a drive you've set up, AshDrive either asks *"Back up to &lt;folder&gt;?"* or backs it up automatically and sends a notification. Backups are incremental — only new or changed files are copied, so repeat backups are fast.

---

## What it does

- **Watches for removable drives** in the background (lives in your system tray / menu bar).
- **On insertion** of a configured drive:
  - *Ask mode* — shows a notification + an in-app prompt: "Back up &lt;name&gt; to &lt;folder&gt;?"
  - *Auto mode* — backs up immediately and sends a "Backup complete" notification.
- **Incremental backup** — copies new/changed files; skips identical files (size + modified time). Files are never deleted from the backup, so it's a safe superset.
- **System junk is skipped** — `System Volume Information`, `$RECYCLE.BIN`, `.Trashes`, `.Spotlight-V100`, `.fseventsd`, etc.
- **Start with login** (optional) so it's always watching.
- **System tray menu** with "Back up now" for any plugged-in drive.

> Note: backups happen **on insertion** (you can also click *Back up now* anytime). A backup can't run on removal, because the drive must be present to read it — AshDrive instead notifies you that the drive was safely removed and reminds you of the last backup time.

---

## Install (ready-made build)

1. **Windows**: run `AshDrive-Setup-1.0.0.exe` and follow the installer.
   - Because the app is unsigned, Windows SmartScreen may warn the first time. Click **More info → Run anyway**.
2. **macOS**: open `AshDrive-1.0.0-universal.dmg`, drag **AshDrive** to **Applications**.
   - Because the app is unsigned, the first launch needs: right-click the app → **Open** → **Open** (or `xattr -dr com.apple.quarantine /Applications/AshDrive.app`).

---

## Run from source

Requirements: **Node.js 18+** (tested on Node 20/22).

```bash
npm install
npm run icon      # generate app + tray icons (one-time)
npm start         # launch the app
npm test          # run logic tests (drive detection + backup)
```

---

## Build the installers

### Windows `.exe` (build on Windows or via CI)
```bash
npm run dist:win
```
Output: `dist/AshDrive-Setup-1.0.0.exe` (NSIS installer).

### macOS `.dmg` (must build **on macOS**)
```bash
npm run dist:mac
```
Output: `dist/AshDrive-1.0.0-universal.dmg` (universal — Apple Silicon + Intel).

> **Important:** a macOS `.dmg` **cannot be created on a Windows machine.** Apple's disk-image tooling (`hdiutil`) only runs on macOS, and `electron-builder` enforces this. You have two ways to get the `.dmg`:
>
> 1. **Run the build on any Mac** — copy this folder to a Mac, `npm install`, `npm run icon`, `npm run dist:mac`. One command, one file out.
> 2. **Build it in the cloud with GitHub Actions** (no Mac required) — push this project to a GitHub repo and either tag a release (`v1.0.0`) or trigger the workflow manually from the **Actions** tab → **Build AshDrive** → **Run workflow**. The workflow (`.github/workflows/build.yml`) builds both the `.exe` (Windows runner) and `.dmg` (macOS runner) and uploads them as downloadable artifacts.
>
> For distribution beyond personal use, sign and notarize the Mac app with an Apple Developer ID, and sign the Windows installer with a code-signing certificate, to remove the warning prompts.

---

## How it works (architecture)

- `src/main.js` — Electron main process: window, tray, drive polling, backup orchestration, notifications, IPC.
- `src/preload.js` — secure context bridge between renderer and main.
- `src/renderer/` — the UI (HTML/CSS/JS): drive cards, add-drive dialog, settings, backup prompts and progress.
- `src/lib/drives.js` — cross-platform removable-drive detection (PowerShell on Windows, `diskutil` on macOS). Pure JS, **no native modules** to compile.
- `src/lib/backup.js` — incremental folder copy with system-junk skipping.
- `scripts/make-icon.mjs` — renders the app icon + tray icons from SVG.
- `electron-builder.yml` — packaging config for Windows (NSIS) and macOS (DMG).

Drive detection polls every 3 seconds using built-in OS tools, so there are no native addons and the Windows `.exe` builds cleanly on this machine. A drive is identified by **volume label + size**, so it's recognised as "the same flash drive" even if its drive letter changes.

---

## Project layout

```
AshDrive/
├─ src/
│  ├─ main.js
│  ├─ preload.js
│  ├─ renderer/   (index.html, styles.css, app.js)
│  ├─ lib/        (drives.js, backup.js)
│  └─ assets/     (logo.svg)
├─ scripts/       (make-icon.mjs, test.cjs)
├─ build/         (generated icons)
├─ .github/workflows/build.yml
├─ electron-builder.yml
└─ package.json
```
