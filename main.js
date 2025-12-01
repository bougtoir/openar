const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: '電子麻酔記録システム',
    show: false
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});

ipcMain.handle('load-config', async (event, configType) => {
  try {
    const configPath = path.join(__dirname, 'config', `${configType}.csv`);
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const data = fs.readFileSync(configPath, 'utf8');
    return parseCSV(data);
  } catch (error) {
    console.error(`Error loading ${configType} config:`, error);
    return null;
  }
});

ipcMain.handle('save-config', async (event, configType, data) => {
  try {
    const configDir = path.join(__dirname, 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const configPath = path.join(configDir, `${configType}.csv`);
    const csvData = convertToCSV(data);
    fs.writeFileSync(configPath, csvData);
    return true;
  } catch (error) {
    console.error(`Error saving ${configType} config:`, error);
    return false;
  }
});

ipcMain.handle('get-current-time', async () => {
  return new Date().toISOString();
});

ipcMain.handle('load-settings', async () => {
  try {
    const settingsPath = path.join(__dirname, 'config', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const data = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading settings:', error);
    return null;
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const configDir = path.join(__dirname, 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const settingsPath = path.join(configDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
});

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const result = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const obj = {};
    
    headers.forEach((header, index) => {
      let value = values[index] || '';
      
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value) && value !== '') value = Number(value);
      
      obj[header] = value;
    });
    
    result.push(obj);
  }
  
  return result;
}

function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvLines = [headers.join(',')];
  
  data.forEach(row => {
    const values = headers.map(header => {
      let value = row[header];
      if (typeof value === 'string' && value.includes(',')) {
        value = `"${value}"`;
      }
      return value;
    });
    csvLines.push(values.join(','));
  });
  
  return csvLines.join('\n');
}
