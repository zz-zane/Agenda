const {app, BrowserWindow, dialog, Menu, session, ipcMain, nativeTheme, shell, Notification} = require('electron');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {createInterface} = require('node:readline');
const path = require('node:path');
const {release} = require('node:os');
const {readFileSync, writeFileSync, renameSync, existsSync} = require('node:fs');

let window, todayWindow, backend, pet, access, updates, quitting = false, stopping = false, stopped = false;
const dataHome = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Agenda');
app.setPath('userData', path.join(dataHome, 'window'));
app.setAppUserModelId('io.github.zz-zane.agenda');
const themeFile = path.join(app.getPath('userData'), 'appearance.json');
let theme = 'light', language = 'zh-CN', shortBoot = false, petEnabled = false;
let voiceSettings = {enabled:false, speak:true, speaker:21, threshold:300};
const validVoice = v => v && typeof v.enabled==='boolean' && typeof v.speak==='boolean' && Number.isInteger(v.speaker) && v.speaker>=0 && v.speaker<174 && Number.isInteger(v.threshold) && v.threshold>=100 && v.threshold<=3000;
try { const saved = JSON.parse(readFileSync(themeFile, 'utf8'));
  if (saved.theme === 'dark') theme = 'dark';
  if (saved.language === 'en') language = 'en';
  shortBoot = saved.shortBoot === true;
  petEnabled = saved.petEnabled === true;
  if (validVoice(saved.voice)) voiceSettings = saved.voice;
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
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    const backendClosed = new Promise(resolve => {
      if (!backend || !backend.pid || backend.exitCode !== null) return resolve();
      backend.once('exit', resolve);
      backend.stdin.end();
      setTimeout(() => { if (backend.exitCode === null) backend.kill(); }, 5000).unref();
    });
    Promise.all([backendClosed, pet?.stop(), access?.close()]).finally(() => { stopped = true; updates?.finishQuit(); app.quit(); });
  });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Agenda 无法启动', '本地服务未能启动，请确认安装完整、数据目录可写，然后重新打开。已有数据不会被删除。');
    app.quit();
  });
}

async function start() {
  access = await require('./access.cjs')(dataHome);
  const token = randomBytes(32).toString('hex');
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'AgendaBackend.exe')
    : path.join(__dirname, '..', '.preview', 'windows-build', 'backend', 'AgendaBackend', 'AgendaBackend.exe');
  const env = {...process.env, AGENDA_DESKTOP_TOKEN: token,
    AGENDA_ACCESS_PORT:String(access.port), AGENDA_ACCESS_TOKEN:access.token,
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
    title: 'Agenda', icon: path.join(__dirname, 'assets', 'agenda.ico'), frame: false, thickFrame: false, transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none', roundedCorners: false, show: false,
    webPreferences: {session: localSession, nodeIntegration: false, contextIsolation: true,
      additionalArguments: ['--agenda-theme=' + theme, '--agenda-language=' + language, '--agenda-short-boot=' + shortBoot, '--agenda-pet=' + petEnabled, '--agenda-voice=' + JSON.stringify(voiceSettings)], sandbox: true, preload: path.join(__dirname, 'preload.cjs'), devTools: !app.isPackaged},
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
  window.on('closed', () => app.quit());
  function openToday() {
    if (quitting) return;
    if (todayWindow && !todayWindow.isDestroyed()) {
      todayWindow.show(); todayWindow.focus();
      todayWindow.webContents.send('agenda-refresh-today');
      return;
    }
    todayWindow = new BrowserWindow({width:480, height:680, minWidth:360, minHeight:420,
      title:'Agenda · Today', icon:path.join(__dirname,'assets','agenda.ico'),
      frame:false, transparent:true, thickFrame:false, backgroundColor:'#00000000',
      show:false, alwaysOnTop:true, maximizable:false, fullscreenable:false,
      webPreferences:{session:localSession, nodeIntegration:false, contextIsolation:true, sandbox:true,
        preload:path.join(__dirname,'preload.cjs'),
        additionalArguments:['--agenda-today', '--agenda-theme='+theme, '--agenda-language='+language],
        devTools:!app.isPackaged}});
    const panel = todayWindow;
    panel.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    panel.webContents.on('will-navigate', event => event.preventDefault());
    panel.on('closed', () => { todayWindow = null; });
    panel.once('ready-to-show', () => { if(!quitting) panel.show(); });
    panel.loadURL(origin+'/?today').catch(() => panel.close());
  }
  function savePet(value) {
    writeFileSync(themeFile + '.tmp', JSON.stringify({theme, language, shortBoot, petEnabled: value, voice:voiceSettings}));
    renameSync(themeFile + '.tmp', themeFile);
    petEnabled = value;
  }
  let petChange = Promise.resolve();
  function setPet(value) {
    petChange = petChange.then(async () => {
      if (quitting) return false;
      try {
        if (value) await pet.start(); else await pet.stop();
        if (quitting) { await pet.stop(); return false; }
        savePet(value);
        window.webContents.send('agenda-pet-changed', value);
        return true;
      } catch {
        await pet.stop();
        try { savePet(false); } catch {}
        if (!window.isDestroyed()) window.webContents.send('agenda-pet-changed', false, true);
        return false;
      }
    });
    return petChange;
  }
  pet = require('./pet.cjs')(executable, {
    openAI() { if (window.isMinimized()) window.restore(); window.show(); window.focus(); window.webContents.send('agenda-open-ai'); },
    openToday,
    disabled() { setPet(false); },
    failed() { try { savePet(false); } catch {} if (!quitting) window.webContents.send('agenda-pet-changed', false, true); },
    voiceEvent(event) {
      if (quitting || window.isDestroyed()) return;
      if (event.type==='voice-error') { voiceSettings={...voiceSettings,enabled:false}; try {savePet(petEnabled);} catch {} }
      window.webContents.send('agenda-voice-event',event);
    },
  });
  pet.configure(voiceSettings);
  pet.theme(theme);
  const petSender = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url.startsWith(origin + '/');
  ipcMain.handle('agenda-access',async(event,action,value)=>{
    if(!petSender(event))return {error:'权限请求无效'};
    try {
      if(action==='state')return access.status();
      if(action==='enabled')return await access.setEnabled(value);
      if(action==='add'&&['apps','files'].includes(value)){
        const result=await dialog.showOpenDialog(window,{title:value==='apps'?'选择允许打开的软件':'选择允许 AI 读取的代码文件',properties:['openFile'],
          filters:value==='apps'?[{name:'Application',extensions:['exe']}]:[{name:'Code',extensions:['py','js','mjs','cjs','ts','tsx','jsx','html','css','c','h','cpp','hpp','cs','java','go','rs','rb','php','swift','kt','sql','vue','svelte']}]});
        if(!result.canceled && result.filePaths[0])return await access.add(value,result.filePaths[0]);
        return access.status();
      }
      if(action==='remove'&&value&&typeof value.id==='string')return await access.remove(value.kind,value.id);
      if(action==='output'){
        if(!existsSync(access.status().output))return {error:'尚未生成修改副本，请先让 AI 修复已授权的代码文件。'};
        shell.showItemInFolder(access.status().output);return access.status();
      }
      return {error:'不支持此操作'};
    }catch(error){return {error:error.message};}
  });
  ipcMain.on('agenda-today', event => { if(petSender(event)) openToday(); });
  ipcMain.on('agenda-today-close', event => {
    if(todayWindow && event.sender===todayWindow.webContents && event.senderFrame===todayWindow.webContents.mainFrame) todayWindow.close();
  });
  ipcMain.handle('agenda-pet', (event, value) => petSender(event) && typeof value === 'boolean' ? setPet(value) : false);
  ipcMain.on('agenda-pet-state', (event, value) => { if (petSender(event)) pet.state(value); });
  ipcMain.handle('agenda-voice', (event, value) => {
    if (!petSender(event) || !validVoice(value) || (value.enabled && !petEnabled)) return false;
    const previous=voiceSettings;
    try { voiceSettings={enabled:value.enabled,speak:value.speak,speaker:value.speaker,threshold:value.threshold}; savePet(petEnabled); pet.configure(voiceSettings); return true; }
    catch { voiceSettings=previous; return false; }
  });
  ipcMain.on('agenda-voice-reply',(event,value)=>{ if(petSender(event) && value && typeof value.text==='string' && typeof value.ok==='boolean')pet.reply(value.text,value.ok,value.bubble===true); });
  ipcMain.handle('agenda-voice-preview',event=>{if(!petSender(event)||!petEnabled)return false;pet.preview();return true;});
  ipcMain.handle('agenda-theme', (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/') || !['light', 'dark'].includes(value)) return false;
    try {
      writeFileSync(themeFile + '.tmp', JSON.stringify({theme: value, language, shortBoot, petEnabled, voice:voiceSettings}));
      renameSync(themeFile + '.tmp', themeFile);
      theme = value; nativeTheme.themeSource = value;
      pet.theme(theme);
      todayWindow?.webContents.send('agenda-today-theme', theme);
      return true;
    } catch { return false; }
  });
  ipcMain.handle('agenda-preferences', (event, value) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/') || !value
        || !['zh-CN', 'en'].includes(value.language) || typeof value.shortBoot !== 'boolean') return false;
    try {
      writeFileSync(themeFile + '.tmp', JSON.stringify({theme, language: value.language, shortBoot: value.shortBoot, petEnabled, voice:voiceSettings}));
      renameSync(themeFile + '.tmp', themeFile);
      language = value.language; shortBoot = value.shortBoot;
      if(todayWindow) { todayWindow.close(); }
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
  updates=require('./updates.cjs')(require('electron-updater').autoUpdater,{
    directory:app.getPath('userData'),version:app.getVersion(),
    publish:state=>{for(const panel of [window,todayWindow])if(panel&&!panel.isDestroyed())panel.webContents.send('agenda-update-state',state);},
    close:()=>window.close(),
  });
  const updateSender=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url.startsWith(origin+'/');
  ipcMain.handle('agenda-update', (event,action,value)=>{
    if(!updateSender(event))return false;
    if(action==='state')return updates.get();
    if(action==='check')return updates.check();
    if(action==='configure'){const saved=updates.configure(value);if(saved&&value)updates.check();return saved;}
    if(action==='install')return updates.install();
    return false;
  });
  const checkUpdates=()=>{if(app.isPackaged&&!quitting&&updates.get().enabled)updates.check();};
  const updateStart=setTimeout(checkUpdates,30000);updateStart.unref();
  const updateTimer=setInterval(checkUpdates,4*60*60*1000);updateTimer.unref();
  app.once('before-quit',()=>{clearTimeout(updateStart);clearInterval(updateTimer);});
  window.once('ready-to-show', () => window.show());
  await window.loadURL(origin + '/');
  if (petEnabled && !quitting) await setPet(true);
  let checkingReminders=false;
  async function checkReminders(){
    if(quitting || checkingReminders)return;
    checkingReminders=true;
    try{
      const headers={'X-Agenda-Desktop-Token':token};
      const response=await fetch(origin+'/api/reminders/due',{headers,signal:AbortSignal.timeout(5000)});
      if(!response.ok)return;
      const rows=(await response.json()).reminders.slice(0,100);
      if(!rows.length)return;
      const title=language==='en'?'Agenda · Reminders':'Agenda · 提醒';
      const text=title+'\n\n'+rows.map(r=>(r.time || (language==='en'?'Today':'今天'))+' · '+r.title).join('\n');
      let shown=false;
      if(petEnabled)shown=await pet.remind(randomBytes(12).toString('hex'),text);
      else if(Notification.isSupported()){
        shown=await new Promise(resolve=>{
          const notification=new Notification({title,body:text,silent:true});
          const timer=setTimeout(()=>resolve(false),5000);
          notification.once('show',()=>{clearTimeout(timer);resolve(true);});
          notification.once('failed',()=>{clearTimeout(timer);resolve(false);});
          notification.on('click',openToday);notification.show();
        });
      }
      if(shown){
        try{shell.beep();}catch{} // A sound-device failure must not repeat an already displayed reminder.
        const ack=await fetch(origin+'/api/reminders/ack',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ids:rows.map(r=>r.id)}),signal:AbortSignal.timeout(5000)});
        if(ack.ok)for(const panel of [window,todayWindow])if(panel&&!panel.isDestroyed())panel.webContents.send('agenda-reminders-updated');
      }
    }catch{}finally{checkingReminders=false;}
  }
  await checkReminders();
  const reminderTimer=setInterval(checkReminders,15000);reminderTimer.unref();
  app.once('before-quit',()=>clearInterval(reminderTimer));
}
