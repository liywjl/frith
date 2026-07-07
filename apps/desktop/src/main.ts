// Electron shell: run the Frith server in-process (the user's own P2P node)
// and open the web client it serves. All data lives on this machine, under
// the OS per-user app directory.
//
// Dev mode (FRITH_DEV_URL set by scripts/dev.sh): the window is just the
// shell — vite serves the client with HMR and tsx watch runs the server, so
// code changes land without restarting Electron.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { startServer } from '../../server/src/start.js';

if (!app.requestSingleInstanceLock()) app.quit();

function configureEnv() {
  const home = process.env.FRITH_HOME ?? app.getPath('userData');
  process.env.FRITH_DATA ??= path.join(home, 'space');
  process.env.FRITH_FILES ??= path.join(home, 'uploads');
  // Bundled next to main.js by build.mjs.
  process.env.FRITH_WEB_DIST ??= path.join(import.meta.dirname, 'web');
  process.env.FRITH_SEED_DIR ??= path.join(import.meta.dirname, 'seed');
  // Packaged app = production posture: no dev auth, device-bound identity.
  process.env.FRITH_MODE ??= app.isPackaged ? 'production' : 'dev';
  configureMasterKey(home);
}

// The device master key (encrypts the registry, seeds, and space keys at
// rest) is wrapped by the OS keychain via safeStorage. On Linux desktops
// without a real secret service, safeStorage is plaintext-equivalent — fall
// through to the server's 0600 key file instead of pretending.
function configureMasterKey(home: string) {
  if (process.env.FRITH_MASTER_KEY) return;
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    console.warn('[keys] OS keychain unavailable — falling back to a key file');
    return;
  }
  const wrapped = path.join(home, 'master.key.safestorage');
  try {
    process.env.FRITH_MASTER_KEY = safeStorage.decryptString(fs.readFileSync(wrapped));
  } catch {
    const hex = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(wrapped, safeStorage.encryptString(hex), { mode: 0o600 });
    process.env.FRITH_MASTER_KEY = hex;
  }
}

async function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Frith',
    // Frameless, native macOS traffic lights only — no title bar. The lights
    // sit in the sidebar's top strip; the web app pads and adds drag regions
    // when it detects Electron. Other platforms keep their native frame.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 68, y: 16 } }
      : {}),
  });
  // Keep the traffic lights pinned in place even when the window loses focus,
  // so they never vanish and leave an empty strip in the sidebar's top band.
  if (process.platform === 'darwin') win.setWindowButtonVisibility?.(true);
  // The window shows only our own local server; anything else goes to the
  // system browser.
  win.webContents.setWindowOpenHandler(({ url: external }) => {
    void shell.openExternal(external);
    return { action: 'deny' };
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  let url = process.env.FRITH_DEV_URL;
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
