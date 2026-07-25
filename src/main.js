'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  Notification,
  nativeImage,
  shell,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const {
  listRemovableDrives,
  makeIdentity,
  matchIdentity,
  displayName,
  humanSize,
} = require('./lib/drives');
const { backupDrive } = require('./lib/backup');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const SMOKE = process.argv.includes('--smoke');

const POLL_INTERVAL = 3000;

let mainWindow = null;
let tray = null;
let isQuitting = false;

/** @type {{drives:Array, startAtLogin:boolean}} */
let config = { drives: [], startAtLogin: true };
/** @type {Object<string, object>} id -> last backup summary */
let state = {};
/** currently detected removable drives */
let knownDrives = [];
let firstTick = true;
/** id -> { drive, driveConfig } — ask-mode drives awaiting a decision */
const pendingAsk = new Map();
/** id -> true — backups currently running */
const activeBackups = new Map();

const configPath = path.join(app.getPath('userData'), 'config.json');
const statePath = path.join(app.getPath('userData'), 'state.json');

// ---------- config / state persistence ----------
async function loadConfig() {
  try {
    const raw = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    config = {
      drives: Array.isArray(parsed.drives) ? parsed.drives : [],
      startAtLogin: parsed.startAtLogin !== false,
    };
  } catch {
    config = { drives: [], startAtLogin: true };
  }
}

async function saveConfig() {
  await fsp.mkdir(path.dirname(configPath), { recursive: true }).catch(() => {});
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2)).catch(() => {});
}

async function loadState() {
  try {
    state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
  } catch {
    state = {};
  }
}

async function saveState() {
  await fsp.mkdir(path.dirname(statePath), { recursive: true }).catch(() => {});
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2)).catch(() => {});
}

// ---------- window ----------
function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 660,
    minWidth: 720,
    minHeight: 520,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: isMac ? '#0b1020' : '#0f172a',
    autoHideMenuBar: true,
    title: 'AshDrive',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!SMOKE) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && !SMOKE) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- tray ----------
function trayIconPath() {
  if (isMac) return path.join(__dirname, '..', 'build', 'trayTemplate.png');
  return path.join(__dirname, '..', 'build', 'tray.png');
}

function createTray() {
  let img;
  try {
    img = nativeImage.createFromPath(trayIconPath());
  } catch {
    img = nativeImage.createEmpty();
  }
  if (img.isEmpty()) {
    img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  }
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('AshDrive');
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const items = [];
  items.push({ label: 'Show AshDrive', click: () => showMainWindow() });

  const presentConfigs = config.drives.filter((dc) =>
    knownDrives.some((d) => matchIdentity(d, dc.identity))
  );
  if (presentConfigs.length) {
    items.push({ type: 'separator' });
    items.push({ label: 'Back up now:', enabled: false });
    for (const dc of presentConfigs) {
      items.push({
        label: dc.name,
        click: () => backupConfigNow(dc.id),
      });
    }
  }
  items.push({ type: 'separator' });
  items.push({ label: 'Quit', click: () => quitApp() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ---------- notifications ----------
function notify(title, body, { onClick } = {}) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, silent: false });
    if (onClick) n.on('click', onClick);
    else n.on('click', () => showMainWindow());
    n.show();
  } catch {
    /* ignore */
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------- backup ----------
function findPresentDriveFor(cfg) {
  return knownDrives.find((d) => matchIdentity(d, cfg.identity));
}

function sanitizeFolderName(name) {
  return (name || 'Drive').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Drive';
}

async function backupConfigNow(id) {
  const cfg = config.drives.find((d) => d.id === id);
  if (!cfg) return;
  const drive = findPresentDriveFor(cfg);
  if (!drive) {
    notify(`${cfg.name} not plugged in`, `Insert ${cfg.name} to back it up.`);
    return;
  }
  await runBackup(cfg, drive);
}

async function runBackup(cfg, drive) {
  if (activeBackups.get(cfg.id)) return;
  pendingAsk.delete(cfg.id);
  activeBackups.set(cfg.id, true);
  rebuildTrayMenu();

  const dest = path.join(cfg.backupFolder, sanitizeFolderName(cfg.name));
  sendToRenderer('backup:start', { id: cfg.id, name: cfg.name });
  notify(`Backing up ${cfg.name}…`, `Copying to ${cfg.backupFolder}`);

  try {
    const stats = await backupDrive({
      source: drive.mountpoint,
      dest,
      onProgress: (p) => sendToRenderer('backup:progress', { id: cfg.id, ...p }),
      shouldStop: () => false,
    });

    const summary = {
      lastBackup: new Date().toISOString(),
      mountpoint: drive.mountpoint,
      copied: stats.copied,
      skipped: stats.skipped,
      errors: stats.errors,
      bytes: stats.bytes,
      totalFiles: stats.totalFiles,
      aborted: stats.aborted,
    };
    state[cfg.id] = summary;
    await saveState();

    if (stats.aborted) {
      notify(`Backup canceled`, `${cfg.name}: backup was canceled.`);
    } else if (stats.errors > 0) {
      notify(
        `Backup complete (with warnings)`,
        `${cfg.name}: ${stats.copied} copied, ${stats.errors} could not be copied.`
      );
    } else {
      notify(
        `Backup complete`,
        `${cfg.name}: ${stats.copied} new/changed, ${stats.skipped} unchanged.`
      );
    }
    sendToRenderer('backup:done', { id: cfg.id, summary });
  } catch (e) {
    notify(`Backup failed`, `${cfg.name}: ${e.message}`);
    sendToRenderer('backup:done', { id: cfg.id, error: e.message });
  } finally {
    activeBackups.delete(cfg.id);
    rebuildTrayMenu();
  }
}

function askBackup(cfg, drive) {
  pendingAsk.set(cfg.id, { drive, driveConfig: cfg });
  notify(`${cfg.name} plugged in`, `Back up to ${cfg.backupFolder}?`, {
    onClick: () => showMainWindow(),
  });
  sendToRenderer('backup:ask', {
    id: cfg.id,
    name: cfg.name,
    folder: cfg.backupFolder,
  });
  rebuildTrayMenu();
}

// ---------- drive events ----------
function evaluateDrive(drive, { silentUnknown = false } = {}) {
  const cfg = config.drives.find((dc) => matchIdentity(drive, dc.identity));
  if (!cfg) {
    if (!silentUnknown) {
      notify(
        'Drive detected',
        `${displayName(drive)} inserted. Open AshDrive to set up backup.`,
        { onClick: () => showMainWindow() }
      );
    }
    return;
  }
  if (cfg.autoBackup) {
    runBackup(cfg, drive);
  } else {
    askBackup(cfg, drive);
  }
}

function onDriveRemoved(drive) {
  const cfg = config.drives.find((dc) => matchIdentity(drive, dc.identity));
  pendingAsk.delete(cfg && cfg.id);
  if (cfg) {
    const last = state[cfg.id];
    const when = last && last.lastBackup ? new Date(last.lastBackup).toLocaleString() : 'never';
    notify(`${cfg.name} removed`, `Safe to unplug. Last backup: ${when}.`);
  }
  sendToRenderer('drives:update', knownDrives);
}

async function tick() {
  try {
    const drives = await listRemovableDrives();
    const prevMap = new Map(knownDrives.map((d) => [d.mountpoint, d]));
    const nextMap = new Map(drives.map((d) => [d.mountpoint, d]));

    for (const d of drives) {
      if (!prevMap.has(d.mountpoint)) {
        // newly inserted
        evaluateDrive(d, { silentUnknown: firstTick });
      }
    }
    for (const d of knownDrives) {
      if (!nextMap.has(d.mountpoint)) {
        onDriveRemoved(d);
      }
    }

    knownDrives = drives;
    sendToRenderer('drives:update', drives);
    rebuildTrayMenu();
  } catch (e) {
    console.error('poll error:', e);
  } finally {
    firstTick = false;
  }
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => config);
ipcMain.handle('state:get', () => state);

ipcMain.handle('drives:list', async () => {
  knownDrives = await listRemovableDrives();
  return knownDrives;
});

ipcMain.handle('dialog:choose-folder', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a backup folder',
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('config:add-drive', async (_e, payload) => {
  const { drive, name, backupFolder, autoBackup } = payload || {};
  if (!drive || !backupFolder) return { error: 'Missing drive or backup folder.' };
  const id = crypto.randomUUID();
  const dc = {
    id,
    name: (name || '').trim() || displayName(drive),
    identity: makeIdentity(drive),
    backupFolder,
    autoBackup: !!autoBackup,
    createdAt: new Date().toISOString(),
  };
  config.drives.push(dc);
  await saveConfig();
  // if the drive is currently present, act on it now
  const present = knownDrives.find((d) => matchIdentity(d, dc.identity));
  if (present) evaluateDrive(present, { silentUnknown: true });
  rebuildTrayMenu();
  return { ok: true, config };
});

ipcMain.handle('config:update-drive', async (_e, { id, patch }) => {
  const dc = config.drives.find((d) => d.id === id);
  if (!dc) return { error: 'Drive not found.' };
  if (patch.name !== undefined) dc.name = (patch.name || '').trim() || dc.name;
  if (patch.backupFolder !== undefined) dc.backupFolder = patch.backupFolder;
  if (patch.autoBackup !== undefined) dc.autoBackup = !!patch.autoBackup;
  await saveConfig();
  rebuildTrayMenu();
  return { ok: true, config };
});

ipcMain.handle('config:remove-drive', async (_e, id) => {
  config.drives = config.drives.filter((d) => d.id !== id);
  pendingAsk.delete(id);
  await saveConfig();
  rebuildTrayMenu();
  return { ok: true, config };
});

ipcMain.handle('backup:now', async (_e, id) => {
  await backupConfigNow(id);
  return { ok: true };
});

ipcMain.handle('backup:respond', async (_e, { id, accept }) => {
  const pending = pendingAsk.get(id);
  pendingAsk.delete(id);
  if (accept && pending) {
    await runBackup(pending.driveConfig, pending.drive);
  }
  return { ok: true };
});

ipcMain.handle('settings:set', async (_e, patch) => {
  if (patch && patch.startAtLogin !== undefined) {
    config.startAtLogin = !!patch.startAtLogin;
    try {
      app.setLoginItemSettings({ openAtLogin: config.startAtLogin });
    } catch {
      /* ignore */
    }
    await saveConfig();
  }
  return { ok: true, config };
});

ipcMain.handle('open:folder', async (_e, p) => {
  if (p) shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
}));

// ---------- app lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  if (isWin) app.setAppUserModelId('com.ashdrive.app');

  app.whenReady().then(async () => {
    await loadConfig();
    await loadState();

    createWindow();
    createTray();

    try {
      app.setLoginItemSettings({ openAtLogin: config.startAtLogin });
    } catch {
      /* ignore */
    }

    if (SMOKE) {
      mainWindow.webContents.once('did-finish-load', () => {
        console.log('[smoke] window loaded — boot OK');
        setTimeout(() => {
          console.log('[smoke] quitting — boot + tray verified');
          isQuitting = true;
          app.quit();
        }, 2500);
      });
    } else {
      tick();
      setInterval(tick, POLL_INTERVAL);
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    // keep running in the tray on all platforms
  });

  if (isMac) {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  }
}
