const {ipcRenderer, contextBridge} = require('electron');
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
