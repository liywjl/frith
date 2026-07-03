const path = require('path');
const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron');

let worker;

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'Lore P2P (spike)',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  worker = utilityProcess.fork(path.join(__dirname, '..', 'workers', 'swarm.js'));
  worker.on('message', (event) => win.webContents.send('chat:event', event));

  ipcMain.handle('chat:send', (_e, message) => worker.postMessage(message));

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  worker?.kill();
  app.quit();
});
