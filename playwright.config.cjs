'use strict';

// Electron-only tests (we launch the app via _electron.launch); no browser needed.
module.exports = {
  testDir: './test',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  use: { trace: 'off' },
};
