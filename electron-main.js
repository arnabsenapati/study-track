const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let mainWindow = null;
let serverInstance = null;

// Prevent multiple instances on the student's PC
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  try {
    // Always use AppData\Roaming\StudyTrack\data so Desktop EXE and local server share the exact same DB
    const dataDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'StudyTrack', 'data')
      : path.join(app.getPath('userData'), 'data');

    serverInstance = await startServer({
      port: 0, // Automatically pick a free local port so it never conflicts
      dataDir
    });

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: 'StudyTrack — Student Study & Gap Time Tracker',
      icon: path.join(__dirname, 'public', 'icon.ico'),
      backgroundColor: '#f4f6fb',
      autoHideMenuBar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Clean top application menu for the student
    const menuTemplate = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Database Folder on Disk',
            click: () => {
              if (serverInstance && serverInstance.dbPath) {
                shell.showItemInFolder(serverInstance.dbPath);
              }
            }
          },
          {
            label: 'Print Report',
            accelerator: 'CmdOrCtrl+P',
            click: () => {
              if (mainWindow) mainWindow.webContents.print();
            }
          },
          { type: 'separator' },
          { role: 'quit', label: 'Exit StudyTrack' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

    await mainWindow.loadURL(`http://127.0.0.1:${serverInstance.port}`);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    dialog.showErrorBox('StudyTrack Startup Error', err.message || String(err));
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInstance && serverInstance.server) {
    try {
      serverInstance.server.close();
      if (serverInstance.db) serverInstance.db.close();
    } catch (e) {
      // ignore cleanup error
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
