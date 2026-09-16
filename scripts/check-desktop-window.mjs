// Packaged Electron UI, isolated profile, no development Python/Node on the app PATH.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, unlink} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';

const executable = path.resolve(process.argv[2]);
await mkdir('.preview', {recursive: true});
const profile = await mkdtemp(path.resolve('.preview/window-check-'));
const env = {...process.env, LOCALAPPDATA: profile, APPDATA: profile,
  PATH: path.join(process.env.WINDIR, 'System32')};
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'AI_API_KEY', 'DEEPSEEK_API_KEY']) delete env[name];
const args = ['--remote-debugging-port=0'];
let child, socket, origin;
async function until(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Desktop check timed out');
}
async function open(waitForBoot = true) {
  await unlink(path.join(profile, 'Agenda/window/DevToolsActivePort')).catch(error => {if (error.code !== 'ENOENT') throw error;});
  child = spawn(executable, args, {env, windowsHide: true, stdio: 'ignore'});
  const port = await until(async () => {
    assert(child.exitCode === null, 'desktop exited before ready');
    try { return Number((await readFile(path.join(profile, 'Agenda/window/DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { return false; }
  });
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:')); }
    catch { return false; }
  });
  origin = new URL(target.url).origin;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id);
      message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await until(() => evaluate("Boolean(document.querySelector('.month-day.is-today') && document.querySelector('#aiStatus'))" + (waitForBoot ? " && !document.querySelector('#boot-sequence-demo')" : "")));
  return {cdp, evaluate};
}
async function close() {
  const exited = once(child, 'exit');
  socket.send(JSON.stringify({id: 999999, method: 'Runtime.evaluate', params: {expression: "document.querySelector('[data-window-action=close]').click()"}}));
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('close timeout')), 10000).unref())]);
  socket.close(); socket = null;
  assert.equal(child.exitCode, 0);
  await until(async () => { try { await fetch(origin); return false; } catch { return true; } });
}
const bootOnly = process.argv.includes('--boot');
if (bootOnly) {
  await mkdir(path.join(profile,'Agenda/window'), {recursive:true});
  await writeFile(path.join(profile,'Agenda/window/appearance.json'), JSON.stringify({theme:'dark'}));
}
try {
  if (process.argv.includes('--preferences')) {
    let {cdp,evaluate} = await open();
    assert.equal(await evaluate("document.querySelector('.month-day.is-today .day-checked').textContent"), '😢');
    assert.equal(await evaluate("document.querySelectorAll('.month-day:not(.is-today) .day-checked').length"), 0);
    await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const state=await fetch('/api/state').then(r=>r.json());
      const photo=await fetch('/api/photos/'+state.today,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob});
      if(!photo.ok)throw Error('photo failed');
      const check=await fetch('/api/checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:state.today})});
      if(!check.ok)throw Error('check-in failed');window.dispatchEvent(new Event('agenda-refresh'));})()`);
    await until(()=>evaluate("document.querySelector('.month-day.is-today .day-checked').textContent==='😊'"));
    await evaluate("document.querySelector('[data-page=settings]').click()");
    await until(()=>evaluate("!document.querySelector('#settingsPage').hidden"));
    await evaluate("document.querySelector('#chatInput').value='保留我的原文';const s=document.querySelector('#languageSelect');s.value='en';s.dispatchEvent(new Event('change'))");
    await until(()=>evaluate("document.documentElement.lang==='en'"));
    assert.equal(await evaluate("document.querySelector('#settingsPage h1').textContent"),'Settings');
    assert.equal(await evaluate("document.querySelector('.appearance-settings legend').textContent"),'Display options');
    assert.equal(await evaluate("document.querySelector('#chatInput').value"),'保留我的原文');
    await evaluate("document.querySelector('#shortBoot').click()");
    await until(()=>evaluate("!document.querySelector('#shortBoot').disabled"));
    await evaluate("Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
    const capture=await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile('.preview/settings-english.png',Buffer.from(capture.data,'base64'));
    assert.equal(await evaluate("window.agendaAppearance.setPreferences({language:'invalid',shortBoot:true})"),false);
    for(const theme of ['light','dark']) {
      assert(await evaluate(`window.agendaAppearance.setTheme('${theme}')`));
      await close(); ({cdp,evaluate}=await open(false));
      assert.equal(await evaluate("document.documentElement.lang"),'en');
      assert.equal(await evaluate("document.querySelector('#shortBoot').checked"),true);
      assert.equal(await evaluate("document.querySelector('.boot-status').textContent.replaceAll(String.fromCharCode(160),' ')"),'KEEP GOING');
      assert.equal(await evaluate("document.querySelector('#boot-sequence-demo').classList.contains('short-boot')"),true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-track')).display"),'none');
      await until(()=>evaluate("Boolean(document.querySelector('#boot-sequence-demo.is-split'))"));
      await until(()=>evaluate("!document.querySelector('#boot-sequence-demo')"),3500);
      assert((await evaluate('performance.now()'))<4000);
    }
    await evaluate("document.querySelector('[data-page=settings]').click()");
    await until(()=>evaluate("!document.querySelector('#settingsPage').hidden"));
    await evaluate("const s=document.querySelector('#languageSelect');s.value='zh-CN';s.dispatchEvent(new Event('change'))");
    await until(()=>evaluate("document.documentElement.lang==='zh-CN'"));
    assert.equal(await evaluate("document.querySelector('#settingsPage h1').textContent"),'设置');
    await evaluate("document.querySelector('#shortBoot').click()");
    await until(()=>evaluate("!document.querySelector('#shortBoot').disabled"));
    await close(); ({cdp,evaluate}=await open(false));
    assert.equal(await evaluate("document.documentElement.lang"),'zh-CN');
    assert.equal(await evaluate("document.querySelector('#boot-sequence-demo').classList.contains('short-boot')"),false);
    await close();
    console.log('PASS: real photo check-in updates face; past and future dates neutral; language and intro persist across both themes; Chinese restored; original text preserved');
  } else if (bootOnly) {
    let {cdp,evaluate} = await open(false);
    assert.equal(await evaluate("document.querySelector('#boot-sequence-demo').classList.contains('diagonal-boot')"),true);
    await until(() => evaluate("document.querySelector('.boot-status')?.textContent.replaceAll(String.fromCharCode(160),' ')==='START WITH TODAY'"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-surface')).backgroundColor"),'rgba(0, 0, 0, 0)');
    const textShot = await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile('.preview/boot-dark-text.png',Buffer.from(textShot.data,'base64'));
    await until(() => evaluate("document.querySelector('.boot-status')?.textContent.replaceAll(String.fromCharCode(160),' ')==='KEEP GOING'"));
    await until(() => evaluate("Boolean(document.querySelector('.boot-meteor'))"));
    const first = await evaluate("{const r=document.querySelector('.boot-meteor').getBoundingClientRect();[r.x,r.y]}");
    await until(() => evaluate(`(()=>{const r=document.querySelector('.boot-meteor').getBoundingClientRect();return r.x>${first[0]+15} && r.y>${first[1]+15}})()`));
    const meteor = await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile('.preview/boot-meteor.png',Buffer.from(meteor.data,'base64'));
    await until(() => evaluate("document.querySelector('#boot-sequence-demo').classList.contains('is-split')"));
    await until(() => evaluate("(()=>{const a=new DOMMatrix(getComputedStyle(document.querySelector('.boot-half-top')).transform),b=new DOMMatrix(getComputedStyle(document.querySelector('.boot-half-bottom')).transform);return a.e>20&&a.f< -20&&b.e< -20&&b.f>20})()"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-half-top')).clipPath"),'polygon(0px 0px, 100% 0px, 100% 100%)');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#boot-sequence-demo')).backgroundColor"),'rgba(0, 0, 0, 0)');
    const split = await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile('.preview/boot-diagonal.png',Buffer.from(split.data,'base64'));
    await until(() => evaluate("!document.querySelector('#boot-sequence-demo')"));
    assert(await evaluate("window.agendaAppearance.setTheme('light')"));
    await close();
    ({cdp,evaluate} = await open(false));
    assert.equal(await evaluate("document.querySelector('#boot-sequence-demo').classList.contains('diagonal-boot')"),false);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-surface')).borderTopWidth"),'0px');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.boot-surface')).boxShadow"),'none');
    const daylight = await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile('.preview/boot-light-frosted.png',Buffer.from(daylight.data,'base64'));
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await cdp('Page.reload');
    await until(() => evaluate("Boolean(document.querySelector('#calendarTitle')?.textContent) && !document.querySelector('#boot-sequence-demo')"),3000);
    await close();
    console.log('PASS: dark meteor moves down-right, diagonal panels open outward, light retained, reduced motion exits quickly');
  } else {
  let {cdp, evaluate} = await open();
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  assert.deepEqual(await evaluate("[typeof require, typeof process]"), ['undefined', 'undefined']);
  assert.deepEqual(await evaluate("[document.documentElement.classList.contains('desktop-glass'), getComputedStyle(document.body).backgroundColor, document.querySelectorAll('.window-controls button').length]"), [true, 'rgba(0, 0, 0, 0)', 3]);
  await evaluate("document.querySelector('#sidebarToggle').click()");
  assert.equal(await evaluate("document.querySelector('#sidebarToggle').getAttribute('aria-expanded')"), 'false');
  await evaluate("document.querySelector('#sidebarToggle').click()");
  const state = await evaluate("fetch('/api/state').then(r=>r.json())");
  assert.equal(state.tasks.length, 0); assert.equal(state.photos.length, 0);
  await evaluate("document.querySelector('[data-window-action=minimize]').click()");
  await until(() => evaluate('document.hidden'));
  const second = spawn(executable, [], {env, windowsHide: true, stdio: 'ignore'});
  await Promise.race([once(second, 'exit'), new Promise((_, reject) => setTimeout(() => {second.kill(); reject(Error('single instance failed'));}, 10000).unref())]);
  assert.equal(second.exitCode, 0);
  await until(() => evaluate('!document.hidden'));
  assert.equal(await evaluate("document.querySelector('#modelSettings').closest('.page').id"),'settingsPage');
  await evaluate("document.querySelector('[data-page=ai]').click()");
  await until(() => evaluate("!document.querySelector('#aiPage').hidden"));
  await evaluate("document.querySelector('#aiStatus').click()");
  await until(() => evaluate("!document.querySelector('#settingsPage').hidden"));
  await evaluate("{const f=document.querySelector('#aiConfigForm');f.elements.base_url.value='http://example.com';f.elements.model.value='settings-check';f.requestSubmit()}");
  await until(() => evaluate("document.querySelector('#modelConfigStatus').classList.contains('error')"));
  await evaluate("{const f=document.querySelector('#aiConfigForm');f.elements.base_url.value='https://api.deepseek.com';f.requestSubmit()}");
  await until(() => evaluate("document.querySelector('#modelConfigStatus').textContent==='模型设置已保存'"));
  assert.equal((await evaluate("fetch('/api/ai/state').then(r=>r.json())")).config.model,'settings-check');
  assert.equal(await evaluate("document.querySelector('#aiConfigForm').hidden"),true);
  assert.equal(await evaluate("document.querySelectorAll('.configured-model').length"),1);
  await evaluate("document.querySelector('#addModel').click();const f=document.querySelector('#aiConfigForm');document.querySelector('#modelProvider').value='openai';document.querySelector('#modelProvider').dispatchEvent(new Event('change'));f.elements.model.value='gpt-ui-fixture';f.elements.api_key.value='ui-fixture-key';f.requestSubmit()");
  await until(() => evaluate("document.querySelectorAll('.configured-model').length===2 && document.querySelector('#aiConfigForm').hidden"));
  const models = await evaluate("fetch('/api/ai/state').then(r=>r.json())");
  assert.equal(models.config.model,'gpt-ui-fixture');assert.equal(models.config.configured,true);
  assert(!JSON.stringify(models).includes('ui-fixture-key'));
  await evaluate("document.querySelector('.configured-model .model-actions button:last-child').click()");
  await until(async () => (await evaluate("fetch('/api/ai/state').then(r=>r.json())")).config.model==='settings-check');

  await evaluate("document.querySelector('[data-page=calendar]').click()");
  await until(() => evaluate("!document.querySelector('#calendarPage').hidden"));
  const originalSize = await evaluate('[innerWidth, innerHeight]');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.shell')).borderTopLeftRadius"), '28px');
  await evaluate("document.querySelector('[data-window-action=maximize]').click()");
  await until(async () => JSON.stringify(await evaluate('[innerWidth, innerHeight]')) !== JSON.stringify(originalSize));
  await until(() => evaluate("getComputedStyle(document.querySelector('.shell')).borderTopLeftRadius==='0px'"));
  await evaluate("document.querySelector('[data-window-action=maximize]').click()");
  await until(async () => JSON.stringify(await evaluate('[innerWidth, innerHeight]')) === JSON.stringify(originalSize));
  await until(() => evaluate("getComputedStyle(document.querySelector('.shell')).borderTopLeftRadius==='28px'"));
  await evaluate("document.querySelector('[data-page=ai]').click()");
  await until(() => evaluate("!document.querySelector('#aiPage').hidden"));
  const starPositions = await evaluate("[...document.querySelectorAll('.composer-stars span')].map(s=>s.style.left+','+s.style.top)");
  assert.equal(starPositions.length, 16);
  await until(async () => JSON.stringify(await evaluate("[...document.querySelectorAll('.composer-stars span')].map(s=>s.style.left+','+s.style.top)")) !== JSON.stringify(starPositions));
  await cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.composer-stars span')).animationName"), 'none');
  await cdp('Emulation.setEmulatedMedia', {features:[]});
  await evaluate("document.querySelector('[data-page=import]').click()");
  await until(() => evaluate("document.getAnimations().some(a=>a.animationName==='agenda-page-back')"));
  await evaluate("document.querySelector('[data-page=ai]').click(); document.querySelector('[data-page=calendar]').click(); document.querySelector('[data-view=week]').click()");
  await until(() => evaluate("!document.querySelector('#calendarPage').hidden && Boolean(document.querySelector('.time-slot:not(:disabled)'))"));
  await until(() => evaluate("!document.getAnimations().some(a=>a.playState==='running')"));
  assert.equal(await evaluate("Boolean(document.querySelector('.timeline-actions'))"), false);
  await evaluate("document.querySelector('[data-view=day]').click()");
  await until(() => evaluate("document.querySelectorAll('.day-track').length===1"));
  await evaluate("document.querySelector('.time-slot:not(:disabled)').click()");
  assert.equal(await evaluate("document.querySelector('#taskDialog').open"), true);
  assert.equal(await evaluate("document.querySelector('#taskForm').elements.start.value"), '08:30');
  await evaluate("document.querySelector('[data-close=taskDialog]').click(); document.querySelector('[data-view=week]').click()");
  await until(() => evaluate("document.querySelectorAll('.day-track').length===7"));
  await evaluate("document.querySelector('.time-slot:not(:disabled)').click(); const form=document.querySelector('#taskForm'); form.elements.title.value='桌面隔离验证'; form.elements.start.value='22:30'; form.elements.end.value='23:30'; form.requestSubmit()");
  await until(() => evaluate("!document.querySelector('#taskDialog').open && [...document.querySelectorAll('.event')].some(e=>e.textContent.includes('桌面隔离验证'))"));
  const lightSurface = await evaluate("getComputedStyle(document.querySelector('.shell')).backgroundImage");
  await evaluate("document.querySelector('[data-page=settings]').click()");
  await until(() => evaluate("!document.querySelector('#settingsPage').hidden"));
  assert.equal(await evaluate("window.agendaAppearance.setTheme('invalid')"), false);
  await evaluate("document.querySelector('[name=agendaTheme][value=dark]').click()");
  await until(() => evaluate("document.documentElement.dataset.theme==='dark'"));
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.shell')).backgroundImage"), lightSurface);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.falling-stars')).pointerEvents"), 'none');
  const falling = await evaluate("[...document.querySelectorAll('.falling-stars span')].map(s=>s.getBoundingClientRect().top)");
  await until(async () => (await evaluate("[...document.querySelectorAll('.falling-stars span')].map(s=>s.getBoundingClientRect().top)")).some((y,i)=>y>falling[i]+3));
  await cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.falling-stars')).display"), 'none');
  await cdp('Emulation.setEmulatedMedia', {features:[]});
  for (const page of ['settings','calendar','ai']) {
    await evaluate(`document.querySelector('[data-page=${page}]').click()`);
    await until(() => evaluate(`!document.querySelector('#${page}Page').hidden && !document.getAnimations().some(a=>a.animationName?.startsWith('agenda-page-'))`));
    await evaluate("new Promise(resolve=>setTimeout(resolve,650))");
    const capture = await cdp('Page.captureScreenshot', {format:'png'});
    await writeFile(`.preview/dark-${page}.png`, Buffer.from(capture.data,'base64'));
  }
  const shot = await cdp('Page.captureScreenshot', {format: 'png'});
  await writeFile('.preview/desktop-v2.png', Buffer.from(shot.data, 'base64'));
  await close();
  ({cdp, evaluate} = await open());
  assert.equal(await evaluate("document.documentElement.dataset.theme"), 'dark');
  await evaluate("document.querySelector('[data-page=settings]').click()");
  await until(() => evaluate("!document.querySelector('#settingsPage').hidden"));
  await evaluate("document.querySelector('[name=agendaTheme][value=light]').click()");
  await until(() => evaluate("document.documentElement.dataset.theme==='light'"));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.shell')).backgroundImage"), lightSurface);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.falling-stars')).display"), 'none');
  await cdp('Page.reload');
  await until(() => evaluate("Boolean(document.querySelector('[name=agendaTheme][value=light]:checked'))"));
  assert((await evaluate("fetch('/api/state').then(r=>r.json())")).tasks.some(t => t.title === '桌面隔离验证'));
  await close();
  await writeFile('.preview/desktop-window-check.json', JSON.stringify({profile, data: path.join(profile, 'Agenda/data/calendar.db')}, null, 2));
  console.log('PASS: packaged window, sandboxed renderer, private API, single instance, save/restart persistence, clean backend shutdown; isolated profile: ' + profile);
}
} finally {
  if (socket) socket.close();
  if (child && child.exitCode === null) child.kill();
}
