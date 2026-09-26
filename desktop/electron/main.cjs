'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Electron main uses CommonJS. */
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess, ipcMain } = require('electron');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

app.setName('BloomCode');
// Test runs must not share Chromium state or the real app's single-instance lock.
if (process.env.DESKTOP_TEST_DATA_DIR)
  app.setPath('userData', join(process.env.DESKTOP_TEST_DATA_DIR, 'desktop-profile'));
else {
  // Keep an existing pre-rename Chromium profile and single-instance lock in place; never move
  // it. New installations keep the profile in its own subfolder, apart from the study files.
  const legacyProfile = join(app.getPath('appData'), 'LeetCode Tutor');
  const profile = join(app.getPath('appData'), 'BloomCode', 'desktop-profile');
  app.setPath(
    'userData',
    existsSync(legacyProfile) && !existsSync(profile) ? legacyProfile : profile,
  );
}
let window;
let worker;
let address;
let quitting = false;
let allowQuit = false;
let starting;

function allowedLocal(url) {
  try {
    return Boolean(address) && new URL(url).origin === address;
  } catch {
    return false;
  }
}
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
      void shell.openExternal(parsed.href).catch(() => {});
  } catch {
    /* Invalid links cannot leave the renderer. */
  }
}
function focusWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function navigationState() {
  const history = window?.webContents.navigationHistory;
  const index = history?.getActiveIndex() ?? 0;
  return {
    back: Boolean(history?.canGoBack() && allowedLocal(history.getEntryAtIndex(index - 1)?.url)),
    forward: Boolean(
      history?.canGoForward() && allowedLocal(history.getEntryAtIndex(index + 1)?.url),
    ),
  };
}
function sendNavigation() {
  if (window && !window.isDestroyed())
    window.webContents.send('desktop:navigation-changed', navigationState());
}
function trustedFrame(event) {
  return (
    event.sender === window?.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    allowedLocal(event.senderFrame.url)
  );
}
ipcMain.handle('desktop:navigation', (event) =>
  trustedFrame(event) ? navigationState() : { back: false, forward: false },
);
ipcMain.on('desktop:navigate', (event, direction) => {
  if (!trustedFrame(event)) return;
  const state = navigationState();
  if (direction === 'back' && state.back) window.webContents.navigationHistory.goBack();
  if (direction === 'forward' && state.forward) window.webContents.navigationHistory.goForward();
});

function makeWindow() {
  window = new BrowserWindow({
    title: '',
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#faf9f6',
    show: false,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  // Keep the native title bar blank even when the web page changes its title.
  window.on('page-title-updated', (event) => event.preventDefault());
  window.once('ready-to-show', focusWindow);
  window.webContents.on('did-navigate', sendNavigation);
  window.webContents.on('did-navigate-in-page', sendNavigation);
  window.webContents.on('did-finish-load', sendNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedLocal(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!allowedLocal(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        permission === 'clipboard-sanitized-write' &&
          contents === window?.webContents &&
          details.isMainFrame === true &&
          allowedLocal(details.requestingUrl),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      permission === 'clipboard-sanitized-write' &&
      contents === window?.webContents &&
      details.isMainFrame === true &&
      allowedLocal(origin),
  );
  // The app offers no downloads, so none may start.
  window.webContents.session.on('will-download', (event) => event.preventDefault());
  window.on('closed', () => {
    window = undefined;
  });
  void window.loadFile(join(__dirname, 'starting.html'));
}

async function stopWorker() {
  const child = worker;
  if (!child) return;
  worker = undefined;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.postMessage({ type: 'shutdown' });
    } catch {
      clearTimeout(timeout);
      child.kill();
      resolve();
    }
  });
}

async function startWorker() {
  const root = app.getAppPath();
  const { resolveDataDir } = await import(pathToFileURL(join(root, 'scripts/runtime.mjs')).href);
  const dataDir = process.env.DESKTOP_TEST_DATA_DIR || resolveDataDir();
  const child = utilityProcess.fork(join(root, 'dist/server/desktop.js'), [], {
    cwd: app.isPackaged ? process.resourcesPath : root,
    serviceName: 'BloomCode study server',
    stdio: 'pipe',
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: process.env.DESKTOP_TEST_PORT || process.env.PORT || '4317',
      TUTOR_WEB_ROOT: join(root, 'dist/web'),
      TUTOR_DESKTOP_PARENT_PID: String(process.pid),
    },
  });
  worker = child;
  // Drain output so a full pipe cannot block the backend. Never log local credentials.
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  const url = await new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(
      () => reject(new Error('The study server did not become ready in time.')),
      30000,
    );
    child.on('message', (message) => {
      if (message?.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(message.message));
      }
      if (message?.type === 'ready') {
        const parsed = new URL(message.address);
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
          clearTimeout(timeout);
          reject(new Error('The study server returned an invalid local address.'));
          return;
        }
        ready = true;
        clearTimeout(timeout);
        resolve(parsed.origin);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (worker === child) worker = undefined;
      if (!ready) reject(new Error(`The study server stopped before opening (code ${code}).`));
      else if (!quitting && !starting)
        void showFailure(
          new Error('The study server stopped unexpectedly. Reopen it to continue.'),
        );
    });
  });
  // Packaged apps always load their own backend. Development permits only the
  // dedicated loopback Vite origin, retaining the renderer's navigation boundary.
  const devUrl = !app.isPackaged && process.env.TUTOR_DEV_RENDERER_URL;
  if (devUrl && devUrl !== 'http://127.0.0.1:5173')
    throw new Error('Invalid development renderer address.');
  address = devUrl || url;
  const response = await fetch(`${url}/health`, {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok || (await response.json()).ok !== true)
    throw new Error('The study server failed its readiness check.');
  if (!quitting && window && !window.isDestroyed()) await window.loadURL(address);
}

async function showFailure(error) {
  if (quitting) return;
  await stopWorker();
  const result = await dialog.showMessageBox(window, {
    type: 'error',
    title: 'Could not open BloomCode',
    message: 'Your study workspace could not open.',
    detail: error.message,
    buttons: ['Retry', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) void launch();
  else app.quit();
}
function launch() {
  if (starting || quitting) return starting;
  starting = startWorker();
  void starting.then(
    () => {
      starting = undefined;
    },
    (error) => {
      starting = undefined;
      void showFailure(error);
    },
  );
  return starting;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', focusWindow);
  app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin'
            ? [{ role: 'appMenu' }]
            : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
          { role: 'editMenu' },
          {
            label: 'View',
            submenu: [
              { role: 'reload' },
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { type: 'separator' },
              { role: 'togglefullscreen' },
            ],
          },
          { role: 'windowMenu' },
        ]),
      );
      makeWindow();
      void launch();
    })
    .catch((error) => {
      dialog.showErrorBox('Could not open BloomCode', error.message);
      app.quit();
    });
  app.on('activate', focusWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void stopWorker().finally(() => {
      allowQuit = true;
      app.quit();
    });
  });
}
