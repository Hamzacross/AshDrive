'use strict';

function snapshotKey(drive, platform = process.platform) {
  let mountpoint = String(drive.mountpoint || '').replace(/[\\/]+$/, '');
  if (platform === 'win32') mountpoint = mountpoint.toLowerCase();
  const identity = drive.volumeId
    ? `id:${String(drive.volumeId).toLowerCase()}`
    : `label:${String(drive.label || '').trim().toLowerCase()}|size:${Number(drive.size) || 0}`;
  return `${mountpoint}|${identity}`;
}

function diffSnapshots(previous = [], next = [], platform = process.platform) {
  const previousByKey = new Map(previous.map((drive) => [snapshotKey(drive, platform), drive]));
  const nextByKey = new Map(next.map((drive) => [snapshotKey(drive, platform), drive]));
  return {
    added: next.filter((drive) => !previousByKey.has(snapshotKey(drive, platform))),
    removed: previous.filter((drive) => !nextByKey.has(snapshotKey(drive, platform))),
  };
}

module.exports = { snapshotKey, diffSnapshots };
