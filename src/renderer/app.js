'use strict';

const api = window.ash;
const i18n = window.ashI18n;
const tr = i18n.t;

let config = { drives: [], startAtLogin: true };
let state = {};
let drives = [];
const pending = new Map(); // id -> { name, folder }
const progress = new Map(); // id -> { copied, skipped, bytes }

// ---------- helpers ----------
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const value = v >= 100 || i === 0 ? Math.round(v) : Number(v.toFixed(1));
  return `${new Intl.NumberFormat(i18n.language === 'ar' ? 'ar' : undefined).format(value)} ${units[i]}`;
}

function timeAgo(iso) {
  if (!iso) return tr('never');
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60000) return tr('justNow');
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} ${tr('minuteAgo')}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ${tr('hourAgo')}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} ${tr('dayAgo')}`;
  return new Date(iso).toLocaleDateString(i18n.language === 'ar' ? 'ar' : undefined);
}

function matches(drive, identity) {
  if (!identity) return false;
  if (identity.volumeId && drive.volumeId) return identity.volumeId === drive.volumeId;
  const sameSize = (drive.size || 0) === (identity.size || 0);
  if (!identity.label) return sameSize;
  return (drive.label || '').trim() === identity.label && sameSize;
}

function driveLabel(d) {
  if (d.label && d.label.trim()) return d.label.trim();
  return d.mountpoint || tr('drive');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------- render ----------
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');
const bannersEl = document.getElementById('banners');
const noResultsEl = document.getElementById('noResults');
const activityListEl = document.getElementById('activityList');
const searchInput = document.getElementById('searchDrives');
const driveFilter = document.getElementById('driveFilter');
let appInfo = { version: '2.0.0', platform: '' };

function filteredDrives() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filter = driveFilter.value;
  return (config.drives || []).filter((dc) => {
    const present = drives.some((drive) => matches(drive, dc.identity));
    if (filter === 'connected' && !present) return false;
    if (filter === 'away' && present) return false;
    if (filter === 'automatic' && !dc.autoBackup) return false;
    if (filter === 'ask' && dc.autoBackup) return false;
    if (!query) return true;
    return [dc.name, dc.identity.label, dc.backupFolder, present && drives.find((d) => matches(d, dc.identity))?.mountpoint]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  });
}

function render() {
  const list = config.drives || [];
  const connected = list.filter((dc) => drives.some((drive) => matches(drive, dc.identity))).length;
  const recent = Object.values(state).flatMap((item) => Array.isArray(item.history) ? item.history : []);
  const latest = recent.map((item) => item.at).filter(Boolean).sort().at(-1)
    || Object.values(state).map((item) => item.lastBackup).filter(Boolean).sort().at(-1);
  document.getElementById('statRegistered').textContent = String(list.length);
  document.getElementById('statConnected').textContent = String(connected);
  document.getElementById('statAutomatic').textContent = String(list.filter((dc) => dc.autoBackup).length);
  document.getElementById('statLatest').textContent = latest ? timeAgo(latest) : '—';

  const visible = filteredDrives();
  emptyEl.hidden = list.length > 0;
  noResultsEl.hidden = list.length === 0 || visible.length > 0;
  document.getElementById('driveCount').textContent = `${visible.length} ${visible.length === 1 ? tr('drive') : tr('drives')}`;
  cardsEl.innerHTML = '';
  for (const dc of visible) cardsEl.appendChild(renderCard(dc));
  renderBanners();
  renderActivity();
}

function renderActivity() {
  const names = new Map((config.drives || []).map((dc) => [dc.id, dc.name]));
  const events = Object.entries(state).flatMap(([id, item]) => {
    if (Array.isArray(item.history) && item.history.length) {
      return item.history.map((event) => ({ ...event, driveId: id, name: names.get(id) || 'Drive' }));
    }
    return item.lastBackup ? [{
      at: item.lastBackup,
      status: item.incomplete ? 'incomplete' : item.errors ? 'warning' : 'complete',
      copied: item.copied || 0,
      skipped: item.skipped || 0,
      errors: item.errors || 0,
      name: names.get(id) || 'Drive',
    }] : [];
  }).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);

  if (!events.length) {
    activityListEl.innerHTML = `<div class="activity-empty">${esc(tr('emptyActivity'))}</div>`;
    return;
  }
  activityListEl.innerHTML = events.map((event) => {
    const tone = ['complete', 'warning', 'failed', 'incomplete', 'stopped'].includes(event.status)
      ? event.status : 'complete';
    const summary = event.error || `${event.copied || 0} ${tr('copied')} · ${event.skipped || 0} ${tr('unchanged')}${event.errors ? ` · ${event.errors} ${tr('errors')}` : ''}`;
    return `<button type="button" class="activity-row" data-history-drive="${esc(event.driveId || '')}" data-history-event="${esc(event.id || '')}" aria-label="${esc(`${event.name} ${new Date(event.at).toLocaleString()}`)}">
      <span class="activity-mark ${tone}"></span>
      <div class="activity-main"><strong>${esc(event.name)}</strong><span>${esc(summary)}</span></div>
      <span class="activity-status ${tone}">${esc(tr(tone === 'failed' ? 'statusFailed' : tone))}</span>
      <time>${esc(timeAgo(event.at))}</time>
    </button>`;
  }).join('');
  activityListEl.querySelectorAll('[data-history-event]').forEach((row, index) => {
    row.addEventListener('click', () => openHistory(events[index]));
  });
}

function formatDateTime(iso) {
  const locale = i18n.language === 'ar' ? 'ar' : undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
}

async function openHistory(event) {
  const detail = event.id ? await api.getHistory(event.driveId, event.id) : event;
  if (!detail) return;
  const changes = Array.isArray(detail.changes) ? detail.changes : [];
  const retainedFiles = Array.isArray(detail.retainedFiles) ? detail.retainedFiles : [];
  const failedFiles = Array.isArray(detail.failedFiles) ? detail.failedFiles : [];
  const errorDetails = Array.isArray(detail.errorDetails) ? detail.errorDetails : [];
  const modal = document.getElementById('historyModal');
  document.getElementById('historyTitle').textContent = `${tr('historyTitle')} · ${event.name}`;
  document.getElementById('historyDateValue').textContent = formatDateTime(detail.at || event.at);
  const stats = [
    `${tr(detail.status || event.status || 'complete')}`,
    `${detail.totalFiles || 0} ${tr('scanned')}`,
    `${detail.copied || 0} ${tr('copied')}`,
    `${detail.skipped || 0} ${tr('unchanged')}`,
    `${detail.errors || 0} ${tr('errors')}`,
    `${formatBytes(detail.bytes || 0)} ${tr('bytesCopied')}`,
    `${retainedFiles.length} ${tr('keptLocal')}`,
    `${Math.round((detail.durationMs || 0) / 1000)} ${tr('seconds')} ${tr('duration')}`,
  ];
  document.getElementById('historyStats').innerHTML = stats.map((value) => `<span class="history-stat">${esc(value)}</span>`).join('');

  const filesEl = document.getElementById('historyFiles');
  filesEl.innerHTML = changes.length
    ? changes.map((file) => `<div class="history-file"><span class="history-file-action">${esc(tr(file.action === 'added' ? 'added' : 'updated'))}</span><span class="history-file-path">${esc(file.path)}</span><span>${esc(formatBytes(file.size))}</span></div>`).join('')
    : `<div class="history-empty">${esc(tr('noFilesChanged'))}</div>`;

  document.getElementById('historyRetained').hidden = retainedFiles.length === 0;
  document.getElementById('historyRetainedFiles').innerHTML = retainedFiles.map((file) =>
    `<div class="history-file"><span class="history-file-action">${esc(tr('keptLocal'))}</span><span class="history-file-path">${esc(file.path)}</span><span>${esc(formatBytes(file.size))}</span></div>`
  ).join('');

  const failuresEl = document.getElementById('historyFailures');
  failuresEl.hidden = failedFiles.length === 0 && errorDetails.length === 0;
  document.getElementById('historyFailedFiles').innerHTML = [
    ...failedFiles.map((file) => `<div class="history-file"><span class="history-file-action">${esc(tr('failed'))}</span><span class="history-file-path">${esc(file.path)}</span><span>${esc(file.message || '')}</span></div>`),
    ...errorDetails.map((message) => `<div class="history-file"><span class="history-file-action">${esc(tr('failed'))}</span><span class="history-file-path">${esc(message)}</span></div>`),
  ].join('');
  modal.hidden = false;
}

function renderCard(dc) {
  const present = drives.find((d) => matches(d, dc.identity));
  const busy = progress.has(dc.id);
  const last = state[dc.id];
  const totalBytes = Number(present && present.size) || 0;
  const freeBytes = Math.min(totalBytes, Math.max(0, Number(present && present.free) || 0));
  const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;

  const el = document.createElement('div');
  el.className = 'card';

  let badge = present
    ? busy
      ? `<span class="badge busy">${esc(tr('backingUp'))}</span>`
      : `<span class="badge present">${esc(tr('present'))}</span>`
    : `<span class="badge away">${esc(tr('notPlugged'))}</span>`;
  if (!busy && last && last.incomplete) {
    badge = `<span class="badge incomplete">${esc(tr('incomplete'))}</span>`;
  }

  let lastText = tr('neverBackedUp');
  if (last) {
    const parts = [];
    if (last.error) parts.push(`${tr('failed')}: ${last.error}`);
    else if (last.incomplete) parts.push(tr('incomplete'));
    else if (last.aborted) parts.push(tr('stopped'));
    else {
      if (last.copied) parts.push(`${last.copied} ${tr('copied')}`);
      if (last.skipped) parts.push(`${last.skipped} ${tr('unchanged')}`);
      if (last.errors) parts.push(`${last.errors} ${tr('errors')}`);
    }
    lastText = `${last.lastBackup ? `${tr('lastBackup')} ${timeAgo(last.lastBackup)}` : `${tr('lastAttempt')} ${timeAgo(last.lastAttempt)}`}${
      parts.length ? ' · ' + parts.join(', ') : ''
    }`;
  }
  if (busy) {
    const p = progress.get(dc.id);
    lastText = `${tr('copyProgress')}… ${p.copied} ${tr('files')} (${formatBytes(p.bytes)})${p.currentFile ? ` · ${p.currentFile}` : ''}`;
  }

  el.innerHTML = `
    <div class="card-head">
      <div class="card-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M9 8h6"/><rect x="8" y="8" width="8" height="6" rx="1"/><path d="M10 14v6h4v-6"/><path d="M16 17a3 3 0 1 0 0-4"/></svg>
      </div>
      <div>
        <div class="card-title">${esc(dc.name)}</div>
        <div class="card-sub">${esc(present ? present.mountpoint : dc.identity.label || tr('removable'))} · ${formatBytes(dc.identity.size)}</div>
      </div>
      ${badge}
    </div>
    ${present && totalBytes ? `<div class="capacity"><div class="capacity-track"><span style="width:${usedPercent}%"></span></div><span>${formatBytes(freeBytes)} ${tr('freeOf')} ${formatBytes(totalBytes)}</span></div>` : ''}
    <div class="card-folder">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <a data-folder="${esc(dc.backupFolder)}">${esc(dc.backupFolder)}</a>
    </div>
    <div class="card-last">${esc(lastText)}</div>
    <div class="progress ${busy ? 'active' : ''}" role="progressbar" aria-label="Backup progress"><span></span></div>
    <div class="card-actions">
      <button class="btn primary sm" data-backup="${esc(dc.id)}" ${present && !busy ? '' : 'disabled'}>${esc(tr('backUpNow'))}</button>
      ${busy ? `<button class="btn danger sm" data-cancel="${esc(dc.id)}">${esc(tr('stop'))}</button>` : ''}
      <button class="btn ghost sm" data-toggle-auto="${esc(dc.id)}" data-on="${dc.autoBackup ? 1 : 0}">
        ${esc(dc.autoBackup ? tr('autoOn') : tr('autoOff'))}
      </button>
      <button class="btn danger sm" data-remove="${esc(dc.id)}">${esc(tr('remove'))}</button>
    </div>
  `;

  el.querySelector('[data-folder]').addEventListener('click', (e) => {
    api.openFolder(e.currentTarget.getAttribute('data-folder'));
  });
  el.querySelector('[data-backup]').addEventListener('click', () => api.backupNow(dc.id));
  el.querySelector('[data-cancel]')?.addEventListener('click', () => api.cancelBackup(dc.id));
  el.querySelector('[data-toggle-auto]').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('data-on') === '1';
    api.updateDrive(dc.id, { autoBackup: !on }).then((r) => {
      config = r.config;
      render();
    });
  });
  el.querySelector('[data-remove]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm) {
      api.removeDrive(dc.id).then((r) => {
        config = r.config;
        render();
      });
    } else {
      btn.dataset.confirm = '1';
      btn.textContent = tr('confirmRemove');
      setTimeout(() => {
        if (btn.dataset.confirm) {
          delete btn.dataset.confirm;
          btn.textContent = tr('remove');
        }
      }, 3000);
    }
  });

  return el;
}

function renderBanners() {
  bannersEl.innerHTML = '';
  for (const [id, p] of pending) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = `
      <div class="b-text">
        <div class="b-title">${esc(p.name)} ${esc(tr('pluggedIn'))}</div>
        <div class="b-sub">${esc(tr('backupTo'))} ${esc(p.folder)}${esc(tr('questionMark'))}</div>
      </div>
      <button class="btn ghost sm" data-no>${esc(tr('notNow'))}</button>
      <button class="btn primary sm" data-yes>${esc(tr('backUp'))}</button>
    `;
    b.querySelector('[data-yes]').addEventListener('click', () => {
      pending.delete(id);
      api.respondBackup(id, true);
      renderBanners();
    });
    b.querySelector('[data-no]').addEventListener('click', () => {
      pending.delete(id);
      api.respondBackup(id, false);
      renderBanners();
    });
    bannersEl.appendChild(b);
  }
}

// ---------- add-drive modal ----------
const addModal = document.getElementById('addModal');
const driveSelect = document.getElementById('driveSelect');
const driveName = document.getElementById('driveName');
const backupFolder = document.getElementById('backupFolder');
const autoToggle = document.getElementById('autoToggle');
const saveDrive = document.getElementById('saveDrive');
const driveMeta = document.getElementById('driveMeta');
let selectedDrive = null;

async function refreshDriveSelect() {
  drives = await api.listDrives();
  render();
  refreshDriveSelectFromCurrentList();
}

function refreshDriveSelectFromCurrentList() {
  driveSelect.innerHTML = '';
  if (drives.length === 0) {
    driveSelect.innerHTML = `<option value="">${esc(tr('noDriveDetected'))}</option>`;
    driveMeta.textContent = tr('noDriveDetected');
    selectedDrive = null;
  } else {
    drives.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${driveLabel(d)}  —  ${d.mountpoint} (${formatBytes(d.size)})`;
      driveSelect.appendChild(opt);
    });
    driveSelect.value = '0';
    onDriveSelectChange();
  }
  validateAddForm();
}

async function refreshDrives(button, { updateSelect = false } = {}) {
  const watchText = document.getElementById('watchText');
  button.disabled = true;
  button.textContent = tr('refreshing');
  watchText.textContent = tr('refreshing');
  try {
    drives = await api.listDrives();
    if (updateSelect) {
      refreshDriveSelectFromCurrentList();
      render();
    } else {
      render();
    }
    const result = tr('scanFound').replace('{count}', formatBytesCount(drives.length));
    watchText.textContent = result;
    clearTimeout(refreshDrives.statusTimer);
    refreshDrives.statusTimer = setTimeout(() => { watchText.textContent = tr('watching'); }, 2500);
  } catch {
    watchText.textContent = tr('scanFailed');
    clearTimeout(refreshDrives.statusTimer);
    refreshDrives.statusTimer = setTimeout(() => { watchText.textContent = tr('watching'); }, 3500);
  } finally {
    button.disabled = false;
    button.textContent = tr('refresh');
  }
}

function formatBytesCount(count) {
  return new Intl.NumberFormat(i18n.language === 'ar' ? 'ar' : undefined).format(count);
}

function onDriveSelectChange() {
  const i = Number(driveSelect.value);
  selectedDrive = drives[i] || null;
  if (selectedDrive) {
    driveMeta.textContent = `${tr('detected')}: ${selectedDrive.mountpoint} · ${formatBytes(
      selectedDrive.size
    )} · ${selectedDrive.fs || tr('removable')}`;
    if (!driveName.value) driveName.value = driveLabel(selectedDrive);
  }
}

function validateAddForm() {
  saveDrive.disabled = !(selectedDrive && backupFolder.value);
}

document.getElementById('addBtn').addEventListener('click', async () => {
  driveName.value = '';
  backupFolder.value = '';
  autoToggle.setAttribute('aria-checked', 'true');
  selectedDrive = null;
  addModal.hidden = false;
  await refreshDriveSelect();
});

document.getElementById('refreshDrives').addEventListener('click', (event) =>
  refreshDrives(event.currentTarget, { updateSelect: true })
);
document.getElementById('refreshDrivesTop').addEventListener('click', (event) =>
  refreshDrives(event.currentTarget)
);
searchInput.addEventListener('input', render);
driveFilter.addEventListener('change', render);
driveSelect.addEventListener('change', onDriveSelectChange);
driveName.addEventListener('input', validateAddForm);

document.getElementById('browseFolder').addEventListener('click', async () => {
  const p = await api.chooseFolder();
  if (p) {
    backupFolder.value = p;
    validateAddForm();
  }
});

autoToggle.addEventListener('click', () => {
  const on = autoToggle.getAttribute('aria-checked') === 'true';
  autoToggle.setAttribute('aria-checked', on ? 'false' : 'true');
});

saveDrive.addEventListener('click', async () => {
  if (saveDrive.disabled) return;
  saveDrive.disabled = true;
  const r = await api.addDrive({
    drive: selectedDrive,
    name: driveName.value,
    backupFolder: backupFolder.value,
    autoBackup: autoToggle.getAttribute('aria-checked') === 'true',
  });
  if (r && r.error) {
    saveDrive.disabled = false;
    driveMeta.textContent = r.error;
    return;
  }
  config = r.config;
  addModal.hidden = true;
  render();
});

// ---------- settings modal ----------
const settingsModal = document.getElementById('settingsModal');
const historyModal = document.getElementById('historyModal');
const loginToggle = document.getElementById('loginToggle');
const versionLabel = document.getElementById('versionLabel');

document.getElementById('settingsBtn').addEventListener('click', async () => {
  loginToggle.setAttribute('aria-checked', config.startAtLogin ? 'true' : 'false');
  const info = await api.getAppInfo();
  appInfo = info;
  const platformName = info.platform === 'win32' ? tr('windows') : info.platform === 'darwin' ? tr('macOS') : tr('linux');
  versionLabel.textContent = `AshDrive · ${tr('version')} ${info.version} · ${platformName}`;
  document.getElementById('languageSelect').value = config.language || 'en';
  settingsModal.hidden = false;
});

document.getElementById('languageSelect').addEventListener('change', async (event) => {
  const language = event.currentTarget.value === 'ar' ? 'ar' : 'en';
  const result = await api.setSettings({ language });
  config = result.config;
  i18n.setLanguage(language);
  render();
  const platformName = appInfo.platform === 'win32' ? tr('windows') : appInfo.platform === 'darwin' ? tr('macOS') : tr('linux');
  versionLabel.textContent = `AshDrive · ${tr('version')} ${appInfo.version} · ${platformName}`;
});

document.getElementById('repoLink').addEventListener('click', () => api.openRepository());

loginToggle.addEventListener('click', () => {
  const on = loginToggle.getAttribute('aria-checked') === 'true';
  const next = !on;
  loginToggle.setAttribute('aria-checked', next ? 'true' : 'false');
  api.setSettings({ startAtLogin: next }).then((r) => {
    config = r.config;
  });
});

// ---------- modal close ----------
document.querySelectorAll('[data-close-modal]').forEach((b) =>
  b.addEventListener('click', () => {
    addModal.hidden = true;
    settingsModal.hidden = true;
    historyModal.hidden = true;
  })
);

[addModal, settingsModal, historyModal].forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) m.hidden = true;
  })
);

// ---------- live events ----------
api.onDrivesUpdate((d) => {
  drives = d || [];
  render();
});

api.onBackupAsk((p) => {
  pending.set(p.id, { name: p.name, folder: p.folder });
  renderBanners();
  render();
});

api.onBackupStart((p) => {
  progress.set(p.id, { copied: 0, skipped: 0, bytes: 0 });
  render();
});

api.onBackupProgress((p) => {
  progress.set(p.id, {
    copied: p.copied,
    skipped: p.skipped,
    bytes: p.bytes,
    currentFile: p.currentFile,
  });
  const card = [...cardsEl.children].find(
    (c) => c.querySelector(`[data-backup="${p.id}"]`)
  );
  if (card) {
    const last = card.querySelector('.card-last');
    if (last) last.textContent = `${tr('copyProgress')}… ${p.copied} ${tr('files')} (${formatBytes(p.bytes)})`;
    const bar = card.querySelector('.progress > span');
    if (bar) bar.setAttribute('title', `Copying ${p.currentFile || 'files'}`);
  }
});

api.onBackupDone(async (p) => {
  progress.delete(p.id);
  state = await api.getState();
  render();
});

// ---------- init ----------
(async function init() {
  config = await api.getConfig();
  state = await api.getState();
  i18n.setLanguage(config.language || 'en');
  drives = await api.listDrives();
  render();
})();
