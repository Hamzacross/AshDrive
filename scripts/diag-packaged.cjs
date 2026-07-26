'use strict';

const { _electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'AshDrive.exe');
if (!fs.existsSync(exe)) {
  console.error('Packaged exe not found:', exe);
  process.exit(1);
}

(async () => {
  const app = await _electron.launch({ executablePath: exe });
  const win = await app.firstWindow();
  const events = [];
  win.on('console', (msg) => events.push('console.' + msg.type() + ': ' + msg.text()));
  win.on('pageerror', (e) => events.push('pageerror: ' + (e.stack || e.message)));

  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(800);

  const boot = await win.evaluate(() => ({
    brand: document.querySelector('.brand-name')?.textContent,
    ash: typeof window.ash,
    addModalHidden: document.getElementById('addModal').hidden,
    settingsModalHidden: document.getElementById('settingsModal').hidden,
  }));
  console.log('boot:', JSON.stringify(boot));

  await win.click('#addBtn');
  await win.waitForTimeout(400);
  const afterAdd = await win.evaluate(() => ({ addModalHidden: document.getElementById('addModal').hidden }));
  console.log('after addBtn click:', JSON.stringify(afterAdd));
  await win.click('#addModal [data-close-modal]');
  await win.waitForTimeout(200);

  await win.click('#settingsBtn');
  await win.waitForTimeout(400);
  const afterSettings = await win.evaluate(() => ({ settingsModalHidden: document.getElementById('settingsModal').hidden }));
  console.log('after settingsBtn click:', JSON.stringify(afterSettings));

  const ok =
    boot.ash === 'object' &&
    afterAdd.addModalHidden === false &&
    afterSettings.settingsModalHidden === false;

  console.log('--- events ---');
  console.log(events.join('\n') || '(no console/page events)');
  console.log(ok ? 'PACKAGED BUILD: PASS' : 'PACKAGED BUILD: FAIL');
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('diag error:', e); process.exit(1); });
