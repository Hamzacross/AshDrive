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

async function* walk(dir, root = dir, onReadError = null) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (onReadError) onReadError(dir, error);
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield { path: full, rel: path.relative(root, full), isDir: true };
      yield* walk(full, root, onReadError);
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
  if (Math.abs(srcStat.mtimeMs - d.mtimeMs) > 1) return true;
  return false;
}

/**
 * Incrementally copy `source` (a flash mountpoint) into `dest`.
 * New/changed files are copied; identical files (size + mtime) are skipped.
 * Files are never deleted from the destination, so the backup is a safe superset.
 */
async function backupDrive({ source, dest, onProgress, shouldStop }) {
  const sourcePath = path.resolve(source);
  const destPath = path.resolve(dest);
  const relativeDest = path.relative(sourcePath, destPath);
  if (relativeDest === '' || (!relativeDest.startsWith(`..${path.sep}`) && relativeDest !== '..' && !path.isAbsolute(relativeDest))) {
    throw new Error('Backup folder cannot be inside the drive being backed up. Choose a folder on another drive.');
  }
  if (!fs.existsSync(source)) {
    return {
      copied: 0,
      skipped: 0,
      errors: 0,
      totalFiles: 0,
      bytes: 0,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      aborted: true,
      removedMidCopy: true,
      errorDetails: ['drive not present'],
    };
  }
  await fsp.mkdir(destPath, { recursive: true });
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

  // If the drive disappears mid-copy, every remaining file would error.
  // Check the source once per file and stop cleanly instead.
  for await (const item of walk(source, source, (dir, error) => {
    if (fs.existsSync(source)) {
      stats.errors++;
      stats.errorDetails.push(`read failed: ${path.relative(source, dir) || '.'} — ${error.message}`);
    }
  })) {
    if (shouldStop && shouldStop()) {
      stats.aborted = true;
      break;
    }
    if (!fs.existsSync(source)) {
      stats.aborted = true;
      stats.removedMidCopy = true;
      stats.errorDetails.push('drive removed during backup');
      break;
    }
    const targetPath = path.join(destPath, item.rel);

    if (item.isDir) {
      await fsp.mkdir(targetPath, { recursive: true }).catch(() => {});
      continue;
    }

    stats.totalFiles++;
    let srcStat;
    try {
      srcStat = await fsp.stat(item.path);
    } catch {
      if (!fs.existsSync(source)) {
        stats.aborted = true;
        stats.removedMidCopy = true;
        stats.errorDetails.push('drive removed during backup');
        break;
      }
      stats.errors++;
      stats.errorDetails.push(`stat failed: ${item.rel}`);
      continue;
    }

    if (!(await destDiffers(srcStat, targetPath))) {
      stats.skipped++;
      continue;
    }

    try {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      // Stage each file beside its destination. A disconnect or crash cannot
      // leave a truncated file that looks like a completed backup.
      const tempPath = `${targetPath}.ashdrive-${process.pid}-${Date.now()}.tmp`;
      try {
        await fsp.copyFile(item.path, tempPath);
        await fsp.utimes(tempPath, srcStat.atime, srcStat.mtime).catch(() => {});
        await fsp.rename(tempPath, targetPath);
      } catch (error) {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      stats.copied++;
      stats.bytes += srcStat.size;
      if (onProgress) {
        onProgress({
          rel: item.rel,
          currentFile: item.rel,
          copied: stats.copied,
          skipped: stats.skipped,
          errors: stats.errors,
          bytes: stats.bytes,
        });
      }
    } catch (e) {
      if (!fs.existsSync(source)) {
        stats.aborted = true;
        stats.removedMidCopy = true;
        stats.errorDetails.push('drive removed during backup');
        break;
      }
      stats.errors++;
      stats.errorDetails.push(`copy failed: ${item.rel} — ${e.message}`);
    }
  }

  // walk() intentionally tolerates unreadable directories. Recheck the mount
  // after iteration so removal during the last read is still reported.
  if (!fs.existsSync(source)) {
    stats.aborted = true;
    stats.removedMidCopy = true;
    if (!stats.errorDetails.includes('drive removed during backup')) {
      stats.errorDetails.push('drive removed during backup');
    }
  }

  if (shouldStop && shouldStop()) stats.aborted = true;

  stats.finishedAt = Date.now();
  return stats;
}

module.exports = { backupDrive, walk, SKIP_DIRS };
