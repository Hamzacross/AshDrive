'use strict';

const { test, expect, _electron } = require('@playwright/test');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');

test('app boots and shows the main window', async () => {
  const app = await _electron.launch({ args: [APP_ROOT] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.brand-name')).toHaveText('AshDrive');
  await app.close();
});

test('Add drive button opens the Add drive modal', async () => {
  const app = await _electron.launch({ args: [APP_ROOT] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('#addModal')).toBeHidden();
  await win.click('#addBtn');
  await expect(win.locator('#addModal')).toBeVisible();

  // close it via the X button
  await win.click('#addModal [data-close-modal]');
  await expect(win.locator('#addModal')).toBeHidden();
  await app.close();
});

test('Settings button opens the Settings modal', async () => {
  const app = await _electron.launch({ args: [APP_ROOT] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await expect(win.locator('#settingsModal')).toBeHidden();
  await win.click('#settingsBtn');
  await expect(win.locator('#settingsModal')).toBeVisible();
  await app.close();
});

test('window.ash bridge is exposed to the renderer', async () => {
  const app = await _electron.launch({ args: [APP_ROOT] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const hasAsh = await win.evaluate(() => typeof window.ash === 'object' && !!window.ash.getConfig);
  expect(hasAsh).toBe(true);
  await app.close();
});
