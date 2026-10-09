'use strict';

const { test, expect, _electron } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const APP_ROOT = path.join(__dirname, '..');
const running = [];

async function launchIsolatedApp() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashdrive-ui-'));
  const app = await _electron.launch({ args: [APP_ROOT, `--user-data-dir=${profile}`] });
  running.push({ app, profile });
  return app;
}

test.afterEach(async () => {
  while (running.length) {
    const { app, profile } = running.pop();
    await app.close().catch(() => {});
    const tempRoot = path.resolve(os.tmpdir());
    const target = path.resolve(profile);
    if (target.startsWith(`${tempRoot}${path.sep}`) && path.basename(target).startsWith('ashdrive-ui-')) {
      await fsp.rm(target, { recursive: true, force: true });
    }
  }
});

test('app boots and shows the main window', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.brand-name')).toHaveText('AshDrive');
  await expect(win.locator('#statRegistered')).toHaveText('0');
  await expect(win.locator('#activityTitle')).toHaveText('Recent activity');
});

test('Add drive button opens the Add drive modal', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('#addModal')).toBeHidden();
  await win.click('#addBtn');
  await expect(win.locator('#addModal')).toBeVisible();
  await expect(win.locator('#autoToggle')).toHaveAttribute('aria-checked', 'true');

  // close it via the X button
  await win.click('#addModal [data-close-modal]');
  await expect(win.locator('#addModal')).toBeHidden();
});

test('Settings button opens the Settings modal', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('#settingsModal')).toBeHidden();
  await win.click('#settingsBtn');
  await expect(win.locator('#settingsModal')).toBeVisible();
  await expect(win.locator('#repoLink')).toHaveText('Source code');
  await expect(win.locator('.about-license')).toHaveText('MIT License');
});

test('window.ash bridge is exposed to the renderer', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const hasAsh = await win.evaluate(() => typeof window.ash === 'object' && !!window.ash.getConfig);
  expect(hasAsh).toBe(true);
});

test('dashboard search and mode filters work with a registered drive', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => window.ash.addDrive({
    drive: { label: 'Demo Volume', volumeId: 'ui:test-volume', size: 1024 ** 3, mountpoint: 'Z:\\', free: 512 * 1024 ** 2, fs: 'FAT32' },
    name: 'Travel Disk',
    backupFolder: 'C:\\Backups',
    autoBackup: true,
  }));
  await win.reload();
  await expect(win.locator('.card')).toHaveCount(1);
  await expect(win.locator('#statRegistered')).toHaveText('1');
  await expect(win.locator('#statAutomatic')).toHaveText('1');
  await win.locator('#searchDrives').fill('travel');
  await expect(win.locator('.card')).toHaveCount(1);
  await win.locator('#searchDrives').fill('missing drive');
  await expect(win.locator('.card')).toHaveCount(0);
  await expect(win.locator('#noResults')).toBeVisible();
  await win.locator('#searchDrives').fill('');
  await win.locator('#driveFilter').selectOption('ask');
  await expect(win.locator('.card')).toHaveCount(0);
});

test('Arabic language switches the full dashboard to right-to-left and persists', async () => {
  const app = await launchIsolatedApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.click('#settingsBtn');
  await win.locator('#languageSelect').selectOption('ar');
  await expect(win.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(win.locator('[data-i18n="dashboard"]')).toHaveText('لوحة النسخ الاحتياطي');
  await expect(win.locator('#activityTitle')).toHaveText('النشاط الأخير');
  await expect(win.locator('#repoLink')).toHaveText('الشيفرة المصدرية');
  await win.reload();
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(win.locator('#addBtn')).toContainText('إضافة وحدة');
});
