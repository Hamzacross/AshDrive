'use strict';

const { _electron } = require('@playwright/test');
const path = require('node:path');

(async () => {
  const app = await _electron.launch({ args: [path.join(__dirname, '..')] });
  const win = await app.firstWindow();
  const events = [];
  win.on('console', (msg) => events.push('console.' + msg.type() + ': ' + msg.text()));
  win.on('pageerror', (e) => events.push('pageerror: ' + (e.stack || e.message)));

  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(800);

  const before = await win.evaluate(() => ({
    addModalHidden: document.getElementById('addModal').hidden,
    addBtn: !!document.getElementById('addBtn'),
    settingsBtn: !!document.getElementById('settingsBtn'),
    ash: typeof window.ash,
  }));
  console.log('before:', JSON.stringify(before));

  // 1) physical Playwright click
  try {
    await win.click('#addBtn', { timeout: 5000 });
    console.log('physical click: ok');
  } catch (e) {
    console.log('physical click FAILED:', e.message);
  }
  await win.waitForTimeout(800);
  const after1 = await win.evaluate(() => ({ addModalHidden: document.getElementById('addModal').hidden }));
  console.log('after physical click:', JSON.stringify(after1));

  // 2) programmatic .click()
  await win.evaluate(() => document.getElementById('addBtn').click());
  await win.waitForTimeout(500);
  const after2 = await win.evaluate(() => ({ addModalHidden: document.getElementById('addModal').hidden }));
  console.log('after programmatic click:', JSON.stringify(after2));

  // 3) check whether the handler is attached by testing settings too
  await win.evaluate(() => document.getElementById('settingsBtn').click());
  await win.waitForTimeout(500);
  const after3 = await win.evaluate(() => ({ settingsModalHidden: document.getElementById('settingsModal').hidden }));
  console.log('after settings programmatic click:', JSON.stringify(after3));

  console.log('--- events ---');
  console.log(events.join('\n') || '(no console/page events)');
  await app.close();
})().catch((e) => { console.error('diag error:', e); process.exit(1); });
