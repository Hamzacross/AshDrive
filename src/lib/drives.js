'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    const out = [];
    const errors = [];
    let bytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ err: new Error(`${command} timed out`), stdout: '', stderr: '' });
    }, 10000);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) {
        child.kill();
        finish({ err: new Error(`${command} output exceeded limit`), stdout: '', stderr: '' });
      } else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (err) => finish({ err, stdout: '', stderr: '' }));
    child.on('close', (code) => finish({
      err: code === 0 ? null : new Error(`${command} exited with code ${code}`),
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    }));
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
  const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $d = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,Size,FreeSpace,FileSystem,VolumeSerialNumber; if ($d) { $d | ConvertTo-Json -Compress }";
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  const { stdout, err } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
  if (err) throw err;
  const text = stdout.trim();
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
        volumeId: d.VolumeSerialNumber ? `win:${String(d.VolumeSerialNumber).trim().toUpperCase()}` : null,
      };
    });
}

// ---- macOS: removable volumes under /Volumes ----
async function getMacVolumeInfo(mountpoint) {
  const plist = require('plist');
  const { stdout, err } = await run('diskutil', ['info', '-plist', mountpoint]);
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
    volumeId: p.VolumeUUID ? `mac:${p.VolumeUUID}` : null,
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
      volumeId: info.volumeId,
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
        volumeId: (() => {
          try { return `linux:${fs.statSync(mp).dev}`; } catch { return null; }
        })(),
      });
    }
  }
  return result;
}

async function listRemovableDrives() {
  if (process.platform === 'win32') return await listWindows();
  if (process.platform === 'darwin') return await listMac();
  return await listLinux();
}

// ---- identity + display helpers ----
function makeIdentity(drive) {
  const label = (drive.label || '').trim();
  const size = drive.size || 0;
  const volumeId = drive.volumeId || null;
  return { label, size, volumeId, key: volumeId || `${label}::${size}` };
}

function matchIdentity(drive, identity) {
  if (!identity) return false;
  if (identity.volumeId && drive.volumeId) return drive.volumeId === identity.volumeId;
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
