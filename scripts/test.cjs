'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const {
  listRemovableDrives,
  makeIdentity,
  matchIdentity,
  displayName,
} = require('../src/lib/drives');
const { backupDrive, walk } = require('../src/lib/backup');
const { diffSnapshots, snapshotKey } = require('../src/lib/drive-snapshot');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ✓', msg);
  } else {
    fail++;
    console.log('  ✗', msg);
  }
}

async function main() {
  console.log('Drive scan reconciliation:');
  const initialDrive = { mountpoint: 'E:\\', label: 'Ash', size: 1000, volumeId: 'win:abc' };
  assert(diffSnapshots([], [initialDrive], 'win32').added.length === 1, 'first scan reports a connected drive as inserted');
  const unplugged = diffSnapshots([initialDrive], [], 'win32');
  assert(unplugged.removed.length === 1, 'scan reports unplugging a known drive');
  const reinserted = diffSnapshots([], [initialDrive], 'win32');
  assert(reinserted.added.length === 1, 'scan reports reinsertion after an absent scan');
  const replacement = { ...initialDrive, volumeId: 'win:def' };
  const swapped = diffSnapshots([initialDrive], [replacement], 'win32');
  assert(swapped.added.length === 1 && swapped.removed.length === 1, 'replacement media at the same mountpoint triggers remove and insert');
  assert(snapshotKey(initialDrive, 'win32') === snapshotKey({ ...initialDrive, mountpoint: 'e:\\' }, 'win32'), 'Windows mountpoint comparison ignores letter case');

  console.log('Drive detection:');
  const drives = await listRemovableDrives();
  console.log(`  detected ${drives.length} removable drive(s)`);
  for (const d of drives) {
    console.log(`   - ${displayName(d)}  ${d.mountpoint}  ${d.size} bytes (${d.fs || '?'})`);
  }
  assert(Array.isArray(drives), 'listRemovableDrives returns an array');
  for (const d of drives) {
    assert(typeof d.mountpoint === 'string' && d.mountpoint.length > 0, `drive has a mountpoint: ${d.mountpoint}`);
    assert(typeof d.size === 'number', 'drive has numeric size');
  }

  console.log('\nIdentity matching:');
  const a = makeIdentity({ label: 'MyFlash', size: 1000 });
  assert(matchIdentity({ label: 'MyFlash', size: 1000 }, a), 'same label+size matches');
  assert(!matchIdentity({ label: 'MyFlash', size: 2000 }, a), 'different size does not match');
  assert(!matchIdentity({ label: 'Other', size: 1000 }, a), 'different label does not match');
  assert(matchIdentity({ label: '', size: 1000 }, makeIdentity({ label: '', size: 1000 })), 'empty label matches by size');
  const physical = makeIdentity({ label: 'Old name', size: 1000, volumeId: 'test:volume-1' });
  assert(matchIdentity({ label: 'Renamed', size: 900, volumeId: 'test:volume-1' }, physical), 'volume identity survives label and size changes');
  assert(!matchIdentity({ label: 'Old name', size: 1000, volumeId: 'test:volume-2' }, physical), 'a different volume is not mistaken for a registered drive');

  console.log('\nBackup (incremental copy + skip system dirs):');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ashdrive-test-'));
  const src = path.join(tmp, 'flash');
  const dst = path.join(tmp, 'backup');
  await fsp.mkdir(src);
  await fsp.writeFile(path.join(src, 'a.txt'), 'hello');
  await fsp.mkdir(path.join(src, 'sub'));
  await fsp.writeFile(path.join(src, 'sub', 'b.txt'), 'world');

  let progCalls = 0;
  const s1 = await backupDrive({ source: src, dest: dst, onProgress: () => progCalls++ });
  assert(s1.copied === 2, `first pass copies 2 files (got ${s1.copied})`);
  assert(progCalls === 2, `onProgress fired per copied file (got ${progCalls})`);
  assert(fs.existsSync(path.join(dst, 'a.txt')), 'a.txt copied');
  assert(fs.existsSync(path.join(dst, 'sub', 'b.txt')), 'sub/b.txt copied');
  assert(s1.errors === 0, 'no errors on first pass');

  const s2 = await backupDrive({ source: src, dest: dst });
  assert(s2.copied === 0, `second pass copies nothing (got ${s2.copied})`);
  assert(s2.skipped === 2, `second pass skips 2 unchanged (got ${s2.skipped})`);

  await fsp.writeFile(path.join(src, 'a.txt'), 'hello changed');
  const s3 = await backupDrive({ source: src, dest: dst });
  assert(s3.copied === 1, `third pass copies 1 changed file (got ${s3.copied})`);
  const content = await fsp.readFile(path.join(dst, 'a.txt'), 'utf8');
  assert(content === 'hello changed', 'changed content persisted to backup');
  assert(!(await fsp.readdir(dst)).some((name) => name.endsWith('.tmp')), 'atomic copy leaves no staging files behind');

  console.log('\nSafety and cancellation:');
  let rejectedNestedDestination = false;
  try {
    await backupDrive({ source: src, dest: path.join(src, 'backup-inside') });
  } catch (error) {
    rejectedNestedDestination = /cannot be inside/.test(error.message);
  }
  assert(rejectedNestedDestination, 'backup refuses a destination inside its source');

  let stopRequested = false;
  const stopped = await backupDrive({
    source: src,
    dest: path.join(tmp, 'stopped-backup'),
    shouldStop: () => stopRequested,
    onProgress: () => { stopRequested = true; },
  });
  assert(stopped.aborted, 'backup responds to a stop request');
  assert(stopped.copied === 1, 'backup stops between files without starting the next copy');

  await fsp.mkdir(path.join(src, 'System Volume Information'));
  await fsp.writeFile(path.join(src, 'System Volume Information', 'junk'), 'x');
  await fsp.mkdir(path.join(src, '$RECYCLE.BIN'));
  await fsp.writeFile(path.join(src, '$RECYCLE.BIN', 'trash'), 'x');
  const s4 = await backupDrive({ source: src, dest: dst });
  assert(!fs.existsSync(path.join(dst, 'System Volume Information')), 'System Volume Information skipped');
  assert(!fs.existsSync(path.join(dst, '$RECYCLE.BIN')), '$RECYCLE.BIN skipped');
  assert(s4.errors === 0, 'skipping system dirs produced no errors');

  // large file (size-only diff check)
  await fsp.writeFile(path.join(src, 'big.bin'), Buffer.alloc(5000, 7));
  const s5 = await backupDrive({ source: src, dest: dst });
  assert(s5.copied >= 1, 'large file copied on first sight');
  const s6 = await backupDrive({ source: src, dest: dst });
  assert(s6.copied === 0, 'large file skipped when unchanged');

  // walk yields relative paths
  const walked = [];
  for await (const item of walk(src)) if (!item.isDir) walked.push(item.rel);
  assert(walked.includes('a.txt') && walked.includes(path.join('sub', 'b.txt')), 'walk yields relative paths');

  console.log('\nStop-on-unplug:');
  const s7 = await backupDrive({
    source: path.join(tmp, 'vanished'),
    dest: path.join(tmp, 'dst2'),
  });
  assert(s7.removedMidCopy === true || s7.aborted === true, 'missing source aborts instead of erroring per file');
  assert(s7.errors === 0, 'missing source produces no per-file errors');

  await fsp.rm(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
