// Electron shell: run the Lore server in-process (the user's own P2P node)
// and open the web client it serves. All data lives on this machine, under
// the OS per-user app directory.
//
// Dev mode (LORE_DEV_URL set by scripts/dev.sh): the window is just the
// shell — vite serves the client with HMR and tsx watch runs the server, so
// code changes land without restarting Electron.
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { startServer } from '../../server/src/start.js';

if (!app.requestSingleInstanceLock()) app.quit();

function configureEnv() {
  const home = process.env.LORE_HOME ?? app.getPath('userData');
  process.env.LORE_DATA ??= path.join(home, 'space');
  process.env.LORE_FILES ??= path.join(home, 'uploads');
  // Bundled next to main.js by build.mjs.
  process.env.LORE_WEB_DIST ??= path.join(import.meta.dirname, 'web');
  process.env.LORE_SEED_DIR ??= path.join(import.meta.dirname, 'seed');
}

async function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Lore',
  });
  // The window shows only our own local server; anything else goes to the
  // system browser.
  win.webContents.setWindowOpenHandler(({ url: external }) => {
    void shell.openExternal(external);
    return { action: 'deny' };
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  let url = process.env.LORE_DEV_URL;
  if (!url) {
    configureEnv();
    url = `http://127.0.0.1:${await startServer(0)}`;
  }
  await createWindow(url);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(url);
  });
});

app.on('window-all-closed', () => app.quit());
