// Electron shell: run the Lore server in-process (the user's own P2P node)
// and open the web client it serves. All data lives on this machine, under
// the OS per-user app directory.
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
  process.env.LORE_CORPUS ??= path.join(import.meta.dirname, 'corpus.json');
}

async function createWindow(port: number) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Lore',
  });
  // The window shows only our own local server; anything else goes to the
  // system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  configureEnv();
  const port = await startServer(0);
  await createWindow(port);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(port);
  });
});

app.on('window-all-closed', () => app.quit());
