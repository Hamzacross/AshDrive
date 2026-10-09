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

function sameSourceVersion(previous, srcStat) {
  return Boolean(previous)
    && Number(previous.size) === srcStat.size
    && Math.abs(Number(previous.mtimeMs) - srcStat.mtimeMs) <= 1
    && Math.abs(Number(previous.ctimeMs) - srcStat.ctimeMs) <= 1;
}

/**
 * Incrementally copy `source` (a flash mountpoint) into `dest`.
 * New/changed files are copied; identical files (size + mtime) are skipped.
 * Files are never deleted from the destination, so the backup is a safe superset.
 */
async function backupDrive({ source, dest, onProgress, shouldStop, previousManifest = {}, previousBackupAt }) {
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
      changes: [],
      failedFiles: [],
      retainedFiles: [],
      manifest: { ...previousManifest },
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
    changes: [],
    failedFiles: [],
    retainedFiles: [],
    manifest: { ...previousManifest },
    startedAt: Date.now(),
    finishedAt: null,
    aborted: false,
    errorDetails: [],
  };

  // If the drive disappears mid-copy, every remaining file would error.
  // Check the source once per file and stop cleanly instead.
  const seenFiles = new Set();
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

    seenFiles.add(item.rel);
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

    const previous = previousManifest[item.rel];
    const sourceChanged = previous && !sameSourceVersion(previous, srcStat);
    const targetMissing = !fs.existsSync(targetPath);

    // Once a source version has been backed up, local edits to the backup are
    // left alone while the flash copy is unchanged. A changed flash version is
    // copied over; files missing from the flash are never deleted locally.
    if (previous && !sourceChanged && !targetMissing) {
      stats.skipped++;
      stats.manifest[item.rel] = { size: srcStat.size, mtimeMs: srcStat.mtimeMs, ctimeMs: srcStat.ctimeMs };
      continue;
    }

    if (!previous && !targetMissing) {
      const destinationMatches = !(await destDiffers(srcStat, targetPath));
      let localChangedSinceBackup = false;
      const previousBackupMs = Date.parse(previousBackupAt || '');
      if (!destinationMatches && Number.isFinite(previousBackupMs)) {
        try {
          const destStat = await fsp.stat(targetPath);
          localChangedSinceBackup = destStat.mtimeMs > previousBackupMs + 1
            && srcStat.mtimeMs <= previousBackupMs + 1;
        } catch { /* treat a disappearing destination as needing a copy */ }
      }
      if (destinationMatches || localChangedSinceBackup) {
        stats.skipped++;
        stats.manifest[item.rel] = { size: srcStat.size, mtimeMs: srcStat.mtimeMs, ctimeMs: srcStat.ctimeMs };
        continue;
      }
    }

    const change = { path: item.rel, action: previous ? 'updated' : 'added', size: srcStat.size };

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
      stats.changes.push(change);
      stats.manifest[item.rel] = { size: srcStat.size, mtimeMs: srcStat.mtimeMs, ctimeMs: srcStat.ctimeMs };
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
      stats.failedFiles.push({ path: item.rel, message: e.message });
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

  if (!stats.aborted && stats.errors === 0) {
    for (const [rel, previous] of Object.entries(previousManifest)) {
      if (!seenFiles.has(rel)) stats.retainedFiles.push({ path: rel, size: Number(previous.size) || 0 });
    }
  }

  stats.finishedAt = Date.now();
  return stats;
}

module.exports = { backupDrive, walk, SKIP_DIRS };
