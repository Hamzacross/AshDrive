'use strict';

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');

// OS-managed / junk folders we never copy.
const SKIP_DIRS = new Set([
  'System Volume Information',
  '$RECYCLE.BIN',
  '$RECYCLE.BIN.',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.DocumentRevisions-V100',
  '.TemporaryItems',
  'Recovery',
  'System Recovery',
]);

async function* walk(dir, root = dir) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield { path: full, rel: path.relative(root, full), isDir: true };
      yield* walk(full, root);
    } else if (ent.isFile()) {
      yield { path: full, rel: path.relative(root, full), isDir: false };
    }
  }
}

async function destDiffers(srcStat, destPath) {
  let d;
  try {
    d = await fsp.stat(destPath);
  } catch {
    return true; // missing -> needs copy
  }
  if (d.size !== srcStat.size) return true;
  if (Math.floor(srcStat.mtimeMs / 1000) !== Math.floor(d.mtimeMs / 1000)) return true;
  return false;
}

/**
 * Incrementally copy `source` (a flash mountpoint) into `dest`.
 * New/changed files are copied; identical files (size + mtime) are skipped.
 * Files are never deleted from the destination, so the backup is a safe superset.
 */
async function backupDrive({ source, dest, onProgress, shouldStop }) {
  await fsp.mkdir(dest, { recursive: true });
  const stats = {
    copied: 0,
    skipped: 0,
    errors: 0,
    totalFiles: 0,
    bytes: 0,
    startedAt: Date.now(),
    finishedAt: null,
    aborted: false,
    errorDetails: [],
  };

  for await (const item of walk(source)) {
    if (shouldStop && shouldStop()) {
      stats.aborted = true;
      break;
    }
    const destPath = path.join(dest, item.rel);

    if (item.isDir) {
      await fsp.mkdir(destPath, { recursive: true }).catch(() => {});
      continue;
    }

    stats.totalFiles++;
    let srcStat;
    try {
      srcStat = await fsp.stat(item.path);
    } catch {
      stats.errors++;
      stats.errorDetails.push(`stat failed: ${item.rel}`);
      continue;
    }

    if (!(await destDiffers(srcStat, destPath))) {
      stats.skipped++;
      continue;
    }

    try {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.copyFile(item.path, destPath);
      await fsp
        .utimes(destPath, srcStat.atime, srcStat.mtime)
        .catch(() => {});
      stats.copied++;
      stats.bytes += srcStat.size;
      if (onProgress) {
        onProgress({
          rel: item.rel,
          copied: stats.copied,
          skipped: stats.skipped,
          errors: stats.errors,
          bytes: stats.bytes,
        });
      }
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push(`copy failed: ${item.rel} — ${e.message}`);
    }
  }

  stats.finishedAt = Date.now();
  return stats;
}

module.exports = { backupDrive, walk, SKIP_DIRS };
