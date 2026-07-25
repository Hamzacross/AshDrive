'use strict';

const { exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function execAsync(cmd, options = {}) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function humanSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// ---- Windows: removable logical disks (DriveType=2) ----
async function listWindows() {
  const ps =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "$d = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | " +
    "Select-Object DeviceID,VolumeName,Size,FreeSpace,FileSystem; " +
    "if ($d) { $d | ConvertTo-Json -Compress }";
  const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`);
  const text = stdout.toString().trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .filter((d) => d && d.DeviceID)
    .map((d) => {
      const mount = d.DeviceID.replace(/\\$/, '') + '\\';
      return {
        device: null,
        mountpoint: mount,
        label: (d.VolumeName || '').trim(),
        size: Number(d.Size) || 0,
        free: Number(d.FreeSpace) || 0,
        fs: d.FileSystem || '',
        protocol: 'USB',
      };
    });
}

// ---- macOS: removable volumes under /Volumes ----
async function getMacVolumeInfo(mountpoint) {
  const plist = require('plist');
  const safe = mountpoint.replace(/"/g, '\\"');
  const { stdout, err } = await execAsync(`diskutil info -plist "${safe}"`);
  if (err || !stdout) return null;
  let p;
  try {
    p = plist.parse(stdout.toString());
  } catch {
    return null;
  }
  const removable = p.Removable === true || p.Ejectable === true;
  const protocol = p.Protocol || '';
  const external =
    removable ||
    ['USB', 'Thunderbolt', 'FireWire', 'SD', 'SecureDigital'].includes(protocol);
  let size = 0;
  let free = 0;
  try {
    const s = fs.statfsSync(mountpoint);
    size = s.bsize * s.blocks;
    free = s.bsize * s.bfree;
  } catch {
    /* ignore */
  }
  return {
    label: p.VolumeName || path.basename(mountpoint),
    removable: external,
    protocol,
    size,
    free,
    fs: p.FilesystemType || p.FilesystemName || '',
  };
}

async function listMac() {
  const result = [];
  let entries = [];
  try {
    entries = fs.readdirSync('/Volumes', { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
    const mp = path.join('/Volumes', ent.name);
    if (mp === '/') continue;
    const info = await getMacVolumeInfo(mp);
    if (!info || !info.removable) continue;
    result.push({
      device: null,
      mountpoint: mp,
      label: info.label,
      size: info.size,
      free: info.free,
      fs: info.fs,
      protocol: info.protocol || 'USB',
    });
  }
  return result;
}

// ---- Linux fallback: /media/$USER and /run/media/$USER ----
async function listLinux() {
  const candidates = [
    path.join('/media', require('node:os').userInfo().username),
    '/run/media',
  ];
  const result = [];
  for (const base of candidates) {
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const mp = path.join(base, ent.name);
      let size = 0;
      let free = 0;
      try {
        const s = fs.statfsSync(mp);
        size = s.bsize * s.blocks;
        free = s.bsize * s.bfree;
      } catch {
        continue;
      }
      result.push({
        device: null,
        mountpoint: mp,
        label: ent.name,
        size,
        free,
        fs: '',
        protocol: 'USB',
      });
    }
  }
  return result;
}

async function listRemovableDrives() {
  try {
    if (process.platform === 'win32') return await listWindows();
    if (process.platform === 'darwin') return await listMac();
    return await listLinux();
  } catch (e) {
    return [];
  }
}

// ---- identity + display helpers ----
function makeIdentity(drive) {
  const label = (drive.label || '').trim();
  const size = drive.size || 0;
  return { label, size, key: `${label}::${size}` };
}

function matchIdentity(drive, identity) {
  if (!identity) return false;
  const sameSize = (drive.size || 0) === (identity.size || 0);
  if (!identity.label) return sameSize;
  return (drive.label || '').trim() === identity.label && sameSize;
}

function displayName(drive) {
  if (drive.label && drive.label.trim()) return drive.label.trim();
  if (process.platform === 'win32') return `Drive ${drive.mountpoint}`;
  return path.basename(drive.mountpoint) || 'Drive';
}

module.exports = {
  listRemovableDrives,
  makeIdentity,
  matchIdentity,
  displayName,
  humanSize,
};
