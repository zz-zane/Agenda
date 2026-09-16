const {app, BrowserWindow, dialog, Menu, session, ipcMain, nativeTheme} = require('electron');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {createInterface} = require('node:readline');
const path = require('node:path');
const {release} = require('node:os');
const {readFileSync, writeFileSync, renameSync} = require('node:fs');

let window, backend, quitting = false, stopping = false;
const dataHome = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Agenda');
app.setPath('userData', path.join(dataHome, 'window'));
app.setAppUserModelId('io.github.zz-zane.agenda');
const themeFile = path.join(app.getPath('userData'), 'appearance.json');
let theme = 'light', language = 'zh-CN', shortBoot = false;
try { const saved = JSON.parse(readFileSync(themeFile, 'utf8'));
  if (saved.theme === 'dark') theme = 'dark';
  if (saved.language === 'en') language = 'en';
  shortBoot = saved.shortBoot === true;
} catch {}
nativeTheme.themeSource = theme;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    quitting = true;
    if (!backend || !backend.pid || backend.exitCode !== null) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    backend.once('exit', () => app.quit());
    backend.stdin.end();
    setTimeout(() => { if (backend.exitCode === null) backend.kill(); }, 5000).unref();
  });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Agenda 无法启动', '本地服务未能启动，请确认安装完整、数据目录可写，然后重新打开。已有数据不会被删除。');
    app.quit();
  });
}

async function start() {
  const token = randomBytes(32).toString('hex');
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'AgendaBackend.exe')
    : path.join(__dirname, '..', '.preview', 'windows-build', 'backend', 'AgendaBackend', 'AgendaBackend.exe');
  const env = {...process.env, AGENDA_DESKTOP_TOKEN: token,
    AGENDA_NODE_BINARY: process.execPath, ELECTRON_RUN_AS_NODE: '1'};
  // A desktop install starts without the development shell's provider credentials.
  for (const key of ['AI_API_KEY', 'DEEPSEEK_API_KEY', 'NODE_OPTIONS']) delete env[key];
  backend = spawn(executable, ['--data', path.join(dataHome, 'data')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env,
  });
  backend.stdin.on('error', () => {});
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 30000);
    const lines = createInterface({input: backend.stdout});
    const fail = () => { clearTimeout(timer); reject(Error('backend unavailable')); };
    backend.once('error', fail);
    backend.once('exit', fail);
    lines.once('line', line => {
      clearTimeout(timer);
      try {
        const message = JSON.parse(line);
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) throw Error('port');
        resolve(`http://127.0.0.1:${message.port}`);
      } catch { reject(Error('invalid startup response')); }
    });
  });
  backend.on('exit', () => {
    if (!quitting) { dialog.showErrorBox('Agenda 服务已停止', '请关闭并重新打开 Agenda。已保存的记录保留在本机。'); app.quit(); }
  });
  const localSession = session.fromPartition('agenda-window');
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  localSession.setPermissionCheckHandler(() => false);
  localSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!details.url.startsWith(origin + '/')) return callback({cancel: true});
    callback({requestHeaders: {...details.requestHeaders, 'X-Agenda-Desktop-Token': token}});
  });
  const acrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621;
  window = new BrowserWindow({width: 1280, height: 880, minWidth: 760, minHeight: 600,
    title: 'Agenda', frame: false, thickFrame: false, transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none', roundedCorners: false, show: false,
    webPreferences: {session: localSession, nodeIntegration: false, contextIsolation: true,
      additionalArguments: ['--agenda-theme=' + theme, '--agenda-language=' + language, '--agenda-short-boot=' + shortBoot], sandbox: true, preload: path.join(__dirname, 'preload.cjs'), devTools: !app.isPackaged},
  });
  function roundWindow() {
    if (process.platform !== 'win32') return;
    const expanded = window.isMaximized() || window.isFullScreen();
    // Windows Acrylic paints beyond a custom region; use it only without rounded corners.
    if (acrylic) window.setBackgroundMaterial(expanded ? 'acrylic' : 'none');
    window.setBackgroundColor('#00000000');
    window.webContents.send('agenda-expanded', expanded);
    if (expanded) { window.setShape([]); return; }
    const [width, height] = window.getSize(), radius = 28;
    const shape = [{x: 0, y: radius, width, height: height - radius * 2}];
    for (let y = 0; y < radius; y++) {
      const x = Math.ceil(radius - Math.sqrt(radius ** 2 - (radius - y - .5) ** 2));
      shape.push({x, y, width: width - x * 2, height: 1},
        {x, y: height - y - 1, width: width - x * 2, height: 1});
    }
    window.setShape(shape);
  }
  window.on('resize', roundWindow);
  window.on('maximize', roundWindow);
  window.on('unmaximize', roundWindow);
  window.on('enter-full-screen', roundWindow);
  window.on('leave-full-screen', roundWindow);
  window.webContents.on('did-finish-load', roundWindow);
  roundWindow();
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
  Menu.setApplicationMenu(null);
  ipcMain.handle('agenda-theme', (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/') || !['light', 'dark'].includes(value)) return false;
    try {
      writeFileSync(themeFile + '.tmp', JSON.stringify({theme: value, language, shortBoot}));
      renameSync(themeFile + '.tmp', themeFile);
      theme = value; nativeTheme.themeSource = value;
      return true;
    } catch { return false; }
  });
  ipcMain.handle('agenda-preferences', (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/') || !value
        || !['zh-CN', 'en'].includes(value.language) || typeof value.shortBoot !== 'boolean') return false;
    try {
      writeFileSync(themeFile + '.tmp', JSON.stringify({theme, language: value.language, shortBoot: value.shortBoot}));
      renameSync(themeFile + '.tmp', themeFile);
      language = value.language; shortBoot = value.shortBoot;
      return true;
    } catch { return false; }
  });
  ipcMain.on('agenda-window', (event, action) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/')) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(origin + '/');
}
