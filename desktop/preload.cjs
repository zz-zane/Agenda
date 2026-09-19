const {ipcRenderer, contextBridge} = require('electron');
contextBridge.exposeInMainWorld('agendaPet', {
  openToday: () => ipcRenderer.send('agenda-today'),
  voice: JSON.parse(process.argv.find(v=>v.startsWith('--agenda-voice='))?.slice('--agenda-voice='.length) || '{"enabled":false,"speak":true,"speaker":21,"threshold":300}'),
  setVoice: value => ipcRenderer.invoke('agenda-voice', value),
  reply: (text,ok,bubble=false) => ipcRenderer.send('agenda-voice-reply',{text,ok,bubble}),
  access: (action,value) => ipcRenderer.invoke('agenda-access',action,value),
  previewVoice: () => ipcRenderer.invoke('agenda-voice-preview'),
  enabled: process.argv.includes('--agenda-pet=true'),
  setEnabled: value => ipcRenderer.invoke('agenda-pet', value),
  state: value => ipcRenderer.send('agenda-pet-state', value),
});
const todayOnly = process.argv.includes('--agenda-today');
contextBridge.exposeInMainWorld('agendaToday', {standalone:todayOnly, close:()=>ipcRenderer.send('agenda-today-close')});
ipcRenderer.on('agenda-reminders-updated',()=>window.dispatchEvent(new Event('agenda-reminders-updated')));
ipcRenderer.on('agenda-refresh-today',()=>window.dispatchEvent(new Event('agenda-refresh-today')));
ipcRenderer.on('agenda-today-theme',(_event,theme)=>{document.documentElement.dataset.theme=theme;});
ipcRenderer.on('agenda-voice-event', (_event, detail) => window.dispatchEvent(new CustomEvent('agenda-voice-event',{detail})));
ipcRenderer.on('agenda-open-ai', () => {
  document.querySelector('#dayDialog.today-panel[open]')?.close();
  document.querySelector('[data-page=ai]')?.click();
  document.querySelector('#chatInput')?.focus();
});
ipcRenderer.on('agenda-open-today', () => window.dispatchEvent(new Event('agenda-open-today')));
ipcRenderer.on('agenda-pet-changed', (_event, enabled, failed) => {
  window.dispatchEvent(new CustomEvent('agenda-pet-changed', {detail: {enabled, failed}}));
});
contextBridge.exposeInMainWorld('agendaAppearance', {
  theme: process.argv.includes('--agenda-theme=dark') ? 'dark' : 'light',
  language: process.argv.includes('--agenda-language=en') ? 'en' : 'zh-CN',
  shortBoot: process.argv.includes('--agenda-short-boot=true'),
  setPreferences: value => ipcRenderer.invoke('agenda-preferences', value),
  setTheme: theme => ipcRenderer.invoke('agenda-theme', theme),
});
ipcRenderer.on('agenda-expanded', (_event, expanded) => {
  document.documentElement.classList.toggle('desktop-expanded', expanded === true);
});

window.addEventListener('DOMContentLoaded', () => {
  if(todayOnly) return;
  document.documentElement.classList.add('desktop-glass');
  const controls = document.createElement('div');
  controls.className = 'window-controls';
  for (const [action, label, glyph] of [
    ['minimize', '最小化', '−'], ['maximize', '最大化或还原', '□'], ['close', '关闭', '×'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.windowAction = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = glyph;
    button.addEventListener('click', () => ipcRenderer.send('agenda-window', action));
    controls.append(button);
  }
  document.querySelector('.topline').append(controls);
});

contextBridge.exposeInMainWorld('agendaUpdates',{state:()=>ipcRenderer.invoke('agenda-update','state'),check:()=>ipcRenderer.invoke('agenda-update','check'),configure:enabled=>ipcRenderer.invoke('agenda-update','configure',enabled),install:()=>ipcRenderer.invoke('agenda-update','install')});
ipcRenderer.on('agenda-update-state',(_event,detail)=>window.dispatchEvent(new CustomEvent('agenda-update-state',{detail})));
