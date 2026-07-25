'use strict';

const ash = window.ash;

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
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString();
}

function matches(drive, identity) {
  if (!identity) return false;
  const sameSize = (drive.size || 0) === (identity.size || 0);
  if (!identity.label) return sameSize;
  return (drive.label || '').trim() === identity.label && sameSize;
}

function driveLabel(d) {
  if (d.label && d.label.trim()) return d.label.trim();
  return d.mountpoint || 'Drive';
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

function render() {
  const list = config.drives || [];
  emptyEl.hidden = list.length > 0;
  cardsEl.innerHTML = '';
  for (const dc of list) cardsEl.appendChild(renderCard(dc));
  renderBanners();
}

function renderCard(dc) {
  const present = drives.find((d) => matches(d, dc.identity));
  const busy = progress.has(dc.id);
  const last = state[dc.id];

  const el = document.createElement('div');
  el.className = 'card';

  const badge = present
    ? busy
      ? '<span class="badge busy">Backing up</span>'
      : '<span class="badge present">Present</span>'
    : '<span class="badge away">Not plugged in</span>';

  let lastText = 'Never backed up';
  if (last) {
    const parts = [];
    if (last.aborted) parts.push('canceled');
    else {
      if (last.copied) parts.push(`${last.copied} copied`);
      if (last.skipped) parts.push(`${last.skipped} unchanged`);
      if (last.errors) parts.push(`${last.errors} errors`);
    }
    lastText = `Last backup ${timeAgo(last.lastBackup)}${
      parts.length ? ' · ' + parts.join(', ') : ''
    }`;
  }
  if (busy) {
    const p = progress.get(dc.id);
    lastText = `Copying… ${p.copied} files (${formatBytes(p.bytes)})`;
  }

  el.innerHTML = `
    <div class="card-head">
      <div class="card-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="M9 8h6"/><rect x="8" y="8" width="8" height="6" rx="1"/><path d="M10 14v6h4v-6"/><path d="M16 17a3 3 0 1 0 0-4"/></svg>
      </div>
      <div>
        <div class="card-title">${esc(dc.name)}</div>
        <div class="card-sub">${esc(dc.identity.label || 'No label')} · ${formatBytes(dc.identity.size)}</div>
      </div>
      ${badge}
    </div>
    <div class="card-folder">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <a data-folder="${esc(dc.backupFolder)}">${esc(dc.backupFolder)}</a>
    </div>
    <div class="card-last">${esc(lastText)}</div>
    <div class="progress ${busy ? 'active' : ''}"><span style="width:${busy ? '55%' : '0%'}"></span></div>
    <div class="card-actions">
      <button class="btn primary sm" data-backup="${esc(dc.id)}" ${present && !busy ? '' : 'disabled'}>Back up now</button>
      <button class="btn ghost sm" data-toggle-auto="${esc(dc.id)}" data-on="${dc.autoBackup ? 1 : 0}">
        Auto: ${dc.autoBackup ? 'On' : 'Off'}
      </button>
      <button class="btn danger sm" data-remove="${esc(dc.id)}">Remove</button>
    </div>
  `;

  el.querySelector('[data-folder]').addEventListener('click', (e) => {
    ash.openFolder(e.currentTarget.getAttribute('data-folder'));
  });
  el.querySelector('[data-backup]').addEventListener('click', () => ash.backupNow(dc.id));
  el.querySelector('[data-toggle-auto]').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('data-on') === '1';
    ash.updateDrive(dc.id, { autoBackup: !on }).then((r) => {
      config = r.config;
      render();
    });
  });
  el.querySelector('[data-remove]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm) {
      ash.removeDrive(dc.id).then((r) => {
        config = r.config;
        render();
      });
    } else {
      btn.dataset.confirm = '1';
      btn.textContent = 'Confirm?';
      setTimeout(() => {
        if (btn.dataset.confirm) {
          delete btn.dataset.confirm;
          btn.textContent = 'Remove';
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
        <div class="b-title">${esc(p.name)} is plugged in</div>
        <div class="b-sub">Back up to ${esc(p.folder)}?</div>
      </div>
      <button class="btn ghost sm" data-no>Not now</button>
      <button class="btn primary sm" data-yes>Back up</button>
    `;
    b.querySelector('[data-yes]').addEventListener('click', () => {
      pending.delete(id);
      ash.respondBackup(id, true);
      renderBanners();
    });
    b.querySelector('[data-no]').addEventListener('click', () => {
      pending.delete(id);
      ash.respondBackup(id, false);
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
  drives = await ash.listDrives();
  driveSelect.innerHTML = '';
  if (drives.length === 0) {
    driveSelect.innerHTML = '<option value="">No drive detected</option>';
    driveMeta.textContent = 'No removable drive detected. Plug one in and click Refresh.';
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

function onDriveSelectChange() {
  const i = Number(driveSelect.value);
  selectedDrive = drives[i] || null;
  if (selectedDrive) {
    driveMeta.textContent = `Detected: ${selectedDrive.mountpoint} · ${formatBytes(
      selectedDrive.size
    )} · ${selectedDrive.fs || 'removable'}`;
    if (!driveName.value) driveName.value = driveLabel(selectedDrive);
  }
}

function validateAddForm() {
  saveDrive.disabled = !(selectedDrive && backupFolder.value);
}

document.getElementById('addBtn').addEventListener('click', async () => {
  driveName.value = '';
  backupFolder.value = '';
  autoToggle.setAttribute('aria-checked', 'false');
  selectedDrive = null;
  addModal.hidden = false;
  await refreshDriveSelect();
});

document.getElementById('refreshDrives').addEventListener('click', refreshDriveSelect);
driveSelect.addEventListener('change', onDriveSelectChange);
driveName.addEventListener('input', validateAddForm);

document.getElementById('browseFolder').addEventListener('click', async () => {
  const p = await ash.chooseFolder();
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
  const r = await ash.addDrive({
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
const loginToggle = document.getElementById('loginToggle');
const versionLabel = document.getElementById('versionLabel');

document.getElementById('settingsBtn').addEventListener('click', async () => {
  loginToggle.setAttribute('aria-checked', config.startAtLogin ? 'true' : 'false');
  const info = await ash.getAppInfo();
  versionLabel.textContent = `AshDrive v${info.version} · ${info.platform}`;
  settingsModal.hidden = false;
});

loginToggle.addEventListener('click', () => {
  const on = loginToggle.getAttribute('aria-checked') === 'true';
  const next = !on;
  loginToggle.setAttribute('aria-checked', next ? 'true' : 'false');
  ash.setSettings({ startAtLogin: next }).then((r) => {
    config = r.config;
  });
});

// ---------- modal close ----------
document.querySelectorAll('[data-close-modal]').forEach((b) =>
  b.addEventListener('click', () => {
    addModal.hidden = true;
    settingsModal.hidden = true;
  })
);

[addModal, settingsModal].forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) m.hidden = true;
  })
);

// ---------- live events ----------
ash.onDrivesUpdate((d) => {
  drives = d || [];
  render();
});

ash.onBackupAsk((p) => {
  pending.set(p.id, { name: p.name, folder: p.folder });
  renderBanners();
  render();
});

ash.onBackupStart((p) => {
  progress.set(p.id, { copied: 0, skipped: 0, bytes: 0 });
  render();
});

ash.onBackupProgress((p) => {
  progress.set(p.id, {
    copied: p.copied,
    skipped: p.skipped,
    bytes: p.bytes,
  });
  const card = [...cardsEl.children].find(
    (c) => c.querySelector(`[data-backup="${p.id}"]`)
  );
  if (card) {
    const last = card.querySelector('.card-last');
    if (last) last.textContent = `Copying… ${p.copied} files (${formatBytes(p.bytes)})`;
    const bar = card.querySelector('.progress > span');
    if (bar) bar.style.width = '55%';
  }
});

ash.onBackupDone(async (p) => {
  progress.delete(p.id);
  state = await ash.getState();
  render();
});

// ---------- init ----------
(async function init() {
  config = await ash.getConfig();
  state = await ash.getState();
  drives = await ash.listDrives();
  render();
})();
