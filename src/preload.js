'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ash', {
  // queries
  getConfig: () => ipcRenderer.invoke('config:get'),
  getState: () => ipcRenderer.invoke('state:get'),
  getHistory: (driveId, eventId) => ipcRenderer.invoke('history:get', { driveId, eventId }),
  listDrives: () => ipcRenderer.invoke('drives:list'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openRepository: () => ipcRenderer.invoke('app:open-repository'),

  // config mutations
  addDrive: (payload) => ipcRenderer.invoke('config:add-drive', payload),
  updateDrive: (id, patch) => ipcRenderer.invoke('config:update-drive', { id, patch }),
  removeDrive: (id) => ipcRenderer.invoke('config:remove-drive', id),

  // backup actions
  backupNow: (id) => ipcRenderer.invoke('backup:now', id),
  cancelBackup: (id) => ipcRenderer.invoke('backup:cancel', id),
  respondBackup: (id, accept) => ipcRenderer.invoke('backup:respond', { id, accept }),

  // settings + misc
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  openFolder: (p) => ipcRenderer.invoke('open:folder', p),

  // live events from main
  onDrivesUpdate: (cb) => ipcRenderer.on('drives:update', (_e, p) => cb(p)),
  onBackupAsk: (cb) => ipcRenderer.on('backup:ask', (_e, p) => cb(p)),
  onBackupStart: (cb) => ipcRenderer.on('backup:start', (_e, p) => cb(p)),
  onBackupProgress: (cb) => ipcRenderer.on('backup:progress', (_e, p) => cb(p)),
  onBackupDone: (cb) => ipcRenderer.on('backup:done', (_e, p) => cb(p)),
});
