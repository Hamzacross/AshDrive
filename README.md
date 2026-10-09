# AshDrive

**Automatic, local backups for removable drives.**

AshDrive watches for registered USB drives and keeps a safe, incremental copy in a folder you choose. It runs quietly from the system tray, supports English and Arabic, and never sends your files to a server.

[![Build](https://github.com/Hamzacross/AshDrive/actions/workflows/build.yml/badge.svg)](https://github.com/Hamzacross/AshDrive/actions/workflows/build.yml)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-16786d)](#downloads)
[![License: MIT](https://img.shields.io/badge/license-MIT-66736e.svg)](LICENSE)

## Downloads

Get the latest installers from [GitHub Releases](https://github.com/Hamzacross/AshDrive/releases).

| Platform | Installer | Notes |
| --- | --- | --- |
| Windows | `AshDrive-Setup-2.0.0.exe` | x64 NSIS installer; supports a custom install location |
| macOS | `AshDrive-2.0.0-universal.dmg` | Universal build for Apple silicon and Intel |

Release files include SHA-256 checksums. The installers are currently unsigned, so Windows SmartScreen or macOS Gatekeeper may show a first-run warning.

## Features

- Automatically backs up registered drives when connected, or asks first if you prefer.
- Tracks the versions seen on each flash drive and copies only new or changed drive files on later backups.
- Preserves locally edited backup files when their flash-drive copies have not changed, and keeps local files when they are removed from the drive.
- Click any backup in the activity log to see its date, copied files, errors, and files retained locally.
- Stages each file before replacing its previous backup, so an interrupted copy does not leave a truncated destination file.
- Stops a backup cleanly when its source drive is removed and reports incomplete or failed runs.
- Matches drives using the persistent volume ID supplied by the OS when available.
- Shows connected status, drive capacity, backup history, and live copy progress.
- Search and filter registered drives; stop an active backup from its card.
- English and Arabic interface with right-to-left layout.
- Runs in the system tray and can start when you log in.

## Get started

1. Install and open AshDrive. Click the tray icon at any time to show its window.
2. Connect a removable drive and choose **Add drive**.
3. Choose where backups should be stored and whether backups should start automatically.
4. Reconnect the drive whenever you want to update its backup.

AshDrive skips operating-system folders such as `System Volume Information`, `$RECYCLE.BIN`, `.Trashes`, and `.Spotlight-V100`. Backups are local and remain on your devices.

## Build from source

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm run icon
npm start
```

Run the test suites:

```bash
npm test
npm run test:ui
npm run smoke
```

Build the Windows installer on Windows:

```bash
npm run dist:win
```

Build the universal macOS disk image on macOS:

```bash
npm run dist:mac
```

Both platform builds can also be run from GitHub Actions. Pushing a version tag such as `v2.0.0` builds the Windows and macOS installers, creates SHA-256 checksums, and publishes a GitHub release with all artifacts attached.

## Project layout

| Path | Description |
| --- | --- |
| `src/main.js` | Electron window, tray, drive polling, backup orchestration, and IPC |
| `src/preload.js` | Restricted API bridge for the renderer |
| `src/lib/drives.js` | Windows, macOS, and Linux removable-volume detection |
| `src/lib/backup.js` | Safe incremental copy engine |
| `src/renderer/` | Dashboard, English/Arabic translations, and styles |
| `scripts/` and `test/` | Logic, UI, packaging diagnostics, and icon generation |
| `.github/workflows/build.yml` | Windows/macOS builds and tagged release publishing |

## Privacy and safety

AshDrive copies files only between local paths selected on your computer. It has no telemetry or cloud backup service. It skips symbolic links, never deletes files from the backup destination, and refuses to place a backup inside the drive being copied.

## License

MIT. See [LICENSE](LICENSE).
