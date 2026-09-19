// Packaged Electron UI, isolated profile, no development Python/Node on the app PATH.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
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
  const connection = await connect(target);
  await until(() => connection.evaluate("Boolean(document.querySelector('.month-day.is-today') && document.querySelector('#aiStatus'))" + (waitForBoot ? " && !document.querySelector('#boot-sequence-demo')" : "")));
  return connection;
}
async function connect(target) {
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  const connectionSocket = socket;
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
    pending.set(++id, {resolve, reject}); connectionSocket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
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
  if(process.argv.includes('--updates')){
    let {evaluate,cdp}=await open();
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate("document.querySelector('[data-page=settings]').click()");
    await until(()=>evaluate("document.querySelector('#updateVersion').textContent.includes('3.1.1')"));
    assert.equal(await evaluate("window.agendaUpdates.configure('invalid')"),false);
    await evaluate("document.querySelector('#autoUpdate').click()");
    await until(()=>evaluate("window.agendaUpdates.state().then(s=>s.enabled===false)"));
    await evaluate("document.querySelector('#checkUpdate').click()");
    await until(()=>evaluate("!document.querySelector('#checkUpdate').disabled"),90000);
    const result=await evaluate("window.agendaUpdates.state()");
    assert(['current','unavailable','error'].includes(result.status),'Live source must not offer a downgrade');
    assert.equal(await evaluate("window.agendaUpdates.install()"),false);
    await evaluate("document.querySelector('#updateVersion').scrollIntoView({block:'center'})");
    await writeFile('.preview/updates-settings.png',Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await close();({evaluate,cdp}=await open());
    await until(()=>evaluate("window.agendaUpdates.state().then(s=>s.enabled===false)"));
    await close();console.log('Updates desktop: version, invalid IPC input, live public source check, ready-only installation, persisted opt-out; result '+result.status);process.exit(0);
  }
  if (process.argv.includes('--diary')) {
    let {evaluate,cdp}=await open();
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`(async()=>{
      const post=(url,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      let state=await fetch('/api/state').then(r=>r.json());
      for(const title of ['离散数学 · 集合与关系','读完今天的二十页'])await post('/api/tasks',{date:state.today,title,start:'09:00',end:'10:00'});
      state=await fetch('/api/state').then(r=>r.json());for(const task of state.tasks)await post('/api/tasks/done',{id:task.id});
      for(const color of ['#8caaa0','#c9ab85','#8b98b2']){
        const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,400,400);ctx.fillStyle='#f3e7cd';ctx.beginPath();ctx.arc(240,135,65,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4f6860';ctx.beginPath();ctx.moveTo(0,400);ctx.lineTo(185,190);ctx.lineTo(400,400);ctx.fill();
        await fetch('/api/photos/'+state.today,{method:'POST',body:await new Promise(r=>canvas.toBlob(r))});
      }
      new BroadcastChannel('agenda-calendar-updates').postMessage('saved');
    })()`);
    await evaluate("document.querySelector('[data-page=diary]').click()");
    await until(()=>evaluate("document.querySelectorAll('.diary-print').length===3 && document.querySelectorAll('#diaryTasks li').length===2"));
    const first=await evaluate("document.querySelector('.diary-print:last-child img').src");
    await evaluate("document.querySelector('#diaryPhotos').click()");
    assert.notEqual(await evaluate("document.querySelector('.diary-print:last-child img').src"),first);
    await evaluate("document.querySelector('#diaryPhotos').click();document.querySelector('#diaryPhotos').click()");
    assert.equal(await evaluate("document.querySelector('.diary-print:last-child img').src"),first);
    await evaluate(`const text=document.querySelector('#diaryText');text.value='今天又向前走了一小步。\\n完成了离散数学，也给自己留了一点安静的时间。';text.dispatchEvent(new Event('input',{bubbles:true}));`);
    await until(()=>evaluate("fetch('/api/state').then(r=>r.json()).then(s=>s.diary_entries[0]?.revision===1)"));
    const diaryText=await evaluate("document.querySelector('#diaryText').value");
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    const beforeTurnHeight=await evaluate("document.querySelector('.diary-book').offsetHeight");
    await evaluate("document.querySelector('.diary-right').click()");
    await until(()=>evaluate("Boolean(document.querySelector('.diary-leaf'))"));
    await evaluate("document.querySelector('.diary-leaf').getAnimations()[0].pause()");
    assert.equal(await evaluate("document.querySelector('.diary-book').offsetHeight"),beforeTurnHeight,'book must not shrink beneath the moving page');
    assert(await evaluate("Math.abs(document.querySelector('.diary-leaf').offsetHeight-document.querySelector('.diary-book > .diary-left').offsetHeight)<=1"),'moving paper must fit its destination');
    assert(await evaluate("document.querySelector('.diary-leaf-back')!==null && !document.querySelector('.diary-turn svg') && !document.querySelector('#diaryNext')"));
    await evaluate("document.querySelector('.diary-leaf').getAnimations()[0].pause();document.querySelector('.diary-leaf').getAnimations()[0].currentTime=340");
    await writeFile(path.resolve('.preview/diary-turn.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    assert(await evaluate("(()=>{const leaf=document.querySelector('.diary-leaf');leaf.getAnimations()[0].currentTime=849;const a=leaf.querySelector('.diary-leaf-back').getBoundingClientRect(),b=document.querySelector('.diary-book > .diary-left').getBoundingClientRect();return ['top','bottom','left','right'].every(k=>Math.abs(a[k]-b[k])<2)})()"),'the landing face must align with the real paper');
    await evaluate("document.querySelector('.diary-leaf').getAnimations()[0].finish()");

    await until(()=>evaluate("!document.querySelector('.diary-leaf')"));
    assert.equal(await evaluate("document.querySelector('.diary-book').offsetHeight"),beforeTurnHeight,'landing must not resize the book');
    await evaluate("document.querySelector('.diary-left').click()");
    await until(()=>evaluate("!document.querySelector('.diary-leaf') && !document.querySelector('#diaryText').readOnly"));
    assert.equal(await evaluate("document.querySelector('.diary-book').offsetHeight"),beforeTurnHeight);
    await evaluate("document.querySelector('.diary-right').click();document.querySelector('.diary-right').click();document.querySelector('.diary-right').click()");
    await until(()=>evaluate("!document.querySelector('.diary-leaf') && document.querySelector('#diaryText').readOnly"));
    assert.equal(await evaluate("document.querySelector('.diary-book').offsetHeight"),beforeTurnHeight);

    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate("document.querySelector('#diaryToday').click()");
    await until(()=>evaluate("!document.querySelector('#diaryText').readOnly"));

    await evaluate("document.querySelector('#diaryPageNext').click()");
    await until(()=>evaluate("document.querySelector('.diary-book').classList.contains('diary-future')"));
    assert(await evaluate("document.querySelector('#diaryText').disabled && getComputedStyle(document.querySelector('#diaryForm')).display==='none' && getComputedStyle(document.querySelector('.diary-photo-area')).display==='none' && getComputedStyle(document.querySelector('#diaryTasks')).display==='none'"));
    const tomorrow=await evaluate("document.querySelector('#diaryDate').value");
    assert.equal(await evaluate(`fetch('/api/diary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:'${tomorrow}',content:'not allowed',revision:0})}).then(r=>r.status)`),403);
    await writeFile(path.resolve('.preview/diary-future.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("document.querySelector('#diaryPagePrev').click()");
    await until(()=>evaluate("!document.querySelector('#diaryText').readOnly"));
    assert.equal(await evaluate("document.querySelector('#diaryText').value"),diaryText);

    for(const theme of ['light','dark']){
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await writeFile(path.resolve('.preview/diary-'+theme+'.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    await evaluate("window.originalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/diary'?Promise.resolve(new Response(JSON.stringify({error:'Diary fixture rejection'}),{status:422})):window.originalFetch(url,options);document.querySelector('#diaryText').value+=' 失败后文字仍保留。';document.querySelector('#diaryText').dispatchEvent(new Event('input'))");
    await until(()=>evaluate("document.querySelector('#toast').textContent==='Diary fixture rejection'"));
    await evaluate("document.querySelector('#diaryPagePrev').click()");
    assert(await evaluate("document.querySelector('#diaryText').value.endsWith('失败后文字仍保留。') && !document.querySelector('#diaryText').readOnly"));
    await evaluate("window.fetch=window.originalFetch;document.querySelector('#diarySave').click()");
    await until(()=>evaluate("fetch('/api/state').then(r=>r.json()).then(s=>s.diary_entries[0]?.revision===2)"));
    await evaluate("document.querySelector('#diaryPagePrev').click()");
    await until(()=>evaluate("document.querySelector('#diaryText').readOnly"));
    await evaluate("document.querySelector('#diaryToday').click()");
    await until(()=>evaluate("!document.querySelector('#diaryText').readOnly"));
    await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:false});
    assert(await evaluate("document.documentElement.scrollWidth<=375 && document.querySelector('#diaryPage').scrollWidth<=document.querySelector('#diaryPage').clientWidth"));
    await writeFile(path.resolve('.preview/diary-375.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await close();({evaluate,cdp}=await open());
    await evaluate("document.querySelector('[data-page=diary]').click()");
    assert.equal(await evaluate("document.querySelector('#diaryText').value"),diaryText+' 失败后文字仍保留。');
    await close();console.log('Diary: tasks, photo cycling, autosave, failure recovery, date history, themes, 375px and restart passed.');process.exit(0);
  }
  if (process.argv.includes('--overview')) {
    const fixture=spawnSync('py',['-3.13','-c',`
import sys
from pathlib import Path
from datetime import date,timedelta
import local_server as app
app.DATA=Path(sys.argv[1]);app.initialize()
with app.database() as db:
 for offset,count in enumerate([0,1,3,5,8,10]):
  day=(date.today()-timedelta(days=offset)).isoformat()
  for i in range(10):
   task=f'overview-{offset}-{i}'
   db.execute('INSERT INTO tasks(id,date,title,start,end) VALUES (?,?,?,?,?)',(task,day,f'Example task {i+1}',f'{9+i:02}:00',f'{10+i:02}:00'))
   db.execute('INSERT INTO task_meta(task_id,done) VALUES (?,?)',(task,int(i<count)))
 for i in range(100):
  day=date.today()-timedelta(days=22)+timedelta(days=i//2)
  if day>=date.today():day+=timedelta(days=1)
  task=f'course-{i}'
  db.execute('INSERT INTO tasks(id,date,title,start,end,origin) VALUES (?,?,?,?,?,?)',(task,day.isoformat(),'离散数学','07:00','08:00',task))
  db.execute('INSERT INTO task_meta(task_id,done) VALUES (?,?)',(task,int(i<20)))
`,path.join(profile,'Agenda/data')],{encoding:'utf8',windowsHide:true});
    assert.equal(fixture.status,0,fixture.stderr);
    let {evaluate,cdp}=await open();
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate("document.querySelector('[data-page=overview]').click()");
    await until(()=>evaluate("!document.querySelector('#overviewPage').hidden && document.querySelector('.completion-day.is-today')?.dataset.completed==='0'"));
    assert.equal(await evaluate("document.querySelector('#calendarPage').hidden"),true);
    const courseProgress=()=>evaluate("document.querySelector('[data-group=\"course:离散数学\"] .progress-percent').textContent");
    assert.equal(await courseProgress(),'20%');
    await evaluate("document.querySelector('[data-overview-view=week]').click()");
    assert.equal(await evaluate("document.querySelectorAll('.completion-day').length"),7);
    assert.equal(await courseProgress(),'20%');
    await evaluate("document.querySelector('[data-overview-view=month]').click()");
    assert((await evaluate("document.querySelectorAll('.completion-day').length"))>=28);

    await evaluate("document.querySelector('.completion-day.is-today').click();document.querySelector('#todayTodoList input:not(:disabled)').click()");
    await until(()=>evaluate("document.querySelector('.completion-day.is-today').dataset.completed==='1' && document.querySelectorAll('#todayTodoList input:checked').length===1"));
    assert.equal((await evaluate("fetch('/api/state').then(r=>r.json())")).photos.length,0);
    assert.equal(await evaluate("Boolean(document.querySelector('#checkinButton'))"),false);
    const lightOne=await evaluate("getComputedStyle(document.querySelector('.completion-day.is-today')).backgroundColor");
    await evaluate("document.querySelector('#dayDialog').close();document.querySelector('[data-page=calendar]').click();document.querySelector('[data-view=day]').click()");
    await until(()=>evaluate("document.querySelectorAll('.event input:checked').length===1"));
    // A rejected completion must restore the checkbox and keep the task pending.
    await evaluate("window.originalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/tasks/done'?Promise.resolve(new Response(JSON.stringify({error:'Fixture rejection'}),{status:422})):window.originalFetch(url,options);document.querySelector('.event input:not(:disabled)').click()");
    await until(()=>evaluate("document.querySelector('#toast').textContent==='Fixture rejection' && document.querySelectorAll('.event input:checked').length===1"));
    await evaluate("window.fetch=window.originalFetch;document.querySelector('.event input:not(:disabled)').click()");
    await until(()=>evaluate("document.querySelectorAll('.event input:checked').length===2"));
    assert.equal(await evaluate("document.querySelector('#taskDialog').open"),false,'checkbox must not open edit dialog');
    await evaluate("document.querySelector('.event-details').click()");
    assert(await evaluate("document.querySelector('#taskDialog').open"));
    await evaluate("document.querySelector('#taskDialog').close();document.querySelector('[data-view=week]').click()");
    await until(()=>evaluate("document.querySelectorAll('.day-track').length===7"));
    const mainEvaluate=evaluate,mainSocket=socket;
    await evaluate("window.dispatchEvent(new Event('agenda-open-today'))");
    const port=Number((await readFile(path.join(profile,'Agenda/window/DevToolsActivePort'),'utf8')).split('\n')[0]);
    const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.url.endsWith('/?today')));
    ({evaluate,cdp}=await connect(target));
    await until(()=>evaluate("document.querySelector('#dayDialog')?.open && document.querySelectorAll('#todayTodoList input:checked').length===2"));
    for(let count=3;count<=10;count++){
      await evaluate("document.querySelector('#todayTodoList input:not(:disabled)').click()");
      await until(()=>evaluate(`document.querySelector('#todayTodosTitle').textContent.includes('已完成 ${count} / 10')`));
    }
    await evaluate(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=3;
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],'auto-checkin.png',{type:'image/png'}));
      document.querySelector('#photoInput').files=transfer.files;document.querySelector('#photoInput').dispatchEvent(new Event('change'));
    })()`);
    await until(()=>evaluate("document.querySelector('#photoHint').textContent.includes('已自动打卡')"));
    await until(()=>mainEvaluate("document.querySelector('.completion-day.is-today').dataset.completed==='10' && document.querySelector('.completion-day.is-today').classList.contains('has-checkin') && document.querySelector('#overviewStreak').textContent==='1'"));
    assert.equal(await mainEvaluate("document.querySelector('[data-group=\"task:Example task 1\"] .progress-percent').textContent"),'100%','other window must update progress without focus or manual refresh');
    const todayShot=await cdp('Page.captureScreenshot');await writeFile('.preview/completed-todos.png',Buffer.from(todayShot.data,'base64'));
    socket.send(JSON.stringify({id:999998,method:'Runtime.evaluate',params:{expression:"document.querySelector('[data-close=dayDialog]').click()"}}));
    await until(async()=>!(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(t=>t.url.endsWith('/?today')));
    socket.close();socket=mainSocket;
    const mainTarget=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page'&&t.url===origin+'/');
    socket.close();({evaluate,cdp}=await connect(mainTarget));
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await cdp('Page.bringToFront');
    await evaluate("window.dispatchEvent(new Event('focus'));document.querySelector('[data-page=overview]').click()");
    await until(()=>evaluate("document.querySelector('.completion-day.is-today').dataset.completed==='10'"));
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.completion-day.is-today')).backgroundColor"),lightOne);
    for(const theme of ['light','dark']){
      await evaluate(`document.querySelector('[data-page=settings]').click();document.querySelector('[name=agendaTheme][value=${theme}]').click()`);
      await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`));
      await evaluate("document.querySelector('[data-page=overview]').click()");
      assert(await evaluate("document.querySelector('#completionLegend').getBoundingClientRect().top>=document.querySelector('.completion-grid').getBoundingClientRect().bottom"),'legend must not overlap final week');
      const colors=await evaluate("[...document.querySelectorAll('.completion-day')].filter(n=>Number(n.dataset.completed)>0).map(n=>getComputedStyle(n).backgroundColor)");
      assert(new Set(colors).size>=2,'completion counts must have distinct colors');
      const shot=await cdp('Page.captureScreenshot');await writeFile(`.preview/overview-${theme}.png`,Buffer.from(shot.data,'base64'));
    }
    await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
    assert(await evaluate("document.documentElement.scrollWidth<=innerWidth"),'375px horizontal overflow');
    const narrow=await cdp('Page.captureScreenshot');await writeFile('.preview/overview-375.png',Buffer.from(narrow.data,'base64'));
    await cdp('Emulation.clearDeviceMetricsOverride');
    await evaluate("document.querySelector('#overviewPrev').click()");
    await until(()=>evaluate("!document.querySelector('.completion-day.is-today')"));
    await evaluate("document.querySelector('#overviewToday').click()");
    assert.equal(await evaluate("document.querySelector('.completion-day.is-today').dataset.completed"),'10');
    await close();({evaluate,cdp}=await open());
    const state=await evaluate("fetch('/api/state').then(r=>r.json())");
    assert.equal(state.tasks.filter(t=>t.date===state.today&&t.done).length,10);assert.equal(state.photos.length,1);assert.equal(state.checkins.length,1);
    await close();console.log('PASS: Overview, both palettes, 375px, month navigation, day/week and independent Today checkboxes, rejection recovery, restart persistence; '+profile);
  } else if (process.argv.includes('--pet')) {
    let {evaluate,cdp} = await open();
    if(process.argv.includes('--context')){
      const context=await evaluate("fetch('/api/ai/context').then(r=>r.json())");
      assert.equal(context.has_summary,false);assert.equal(context.status,'ready');
      assert(await evaluate("document.querySelector('#contextStatus').textContent.includes('无需压缩')"));
    }
    if(process.argv.includes('--access')){
      await until(()=>evaluate("document.querySelector('#accessStatus').textContent.includes('关闭')"));
      assert.equal(await evaluate("document.querySelector('#desktopAccess').checked"),false);
      assert((await evaluate("window.agendaPet.access('enabled','invalid')")).error);
      await evaluate("document.querySelector('[data-page=settings]').click();document.querySelector('#desktopAccess').click()");
      await until(()=>evaluate("document.querySelector('#accessStatus').textContent.includes('开启') && !document.querySelector('#desktopAccess').disabled"));
      assert.equal(JSON.parse(await readFile(path.join(profile,'Agenda/desktop-access.json'),'utf8')).enabled,true);
      assert((await evaluate("window.agendaPet.access('execute',{command:'not allowed'})")).error);
      await evaluate("document.querySelector('#desktopAccess').click()");
      await until(()=>evaluate("document.querySelector('#accessStatus').textContent.includes('关闭')"));
    }
    assert.equal(await evaluate("window.agendaPet.setEnabled('invalid')"), false);
    await evaluate("document.querySelector('[data-page=settings]').click();document.querySelector('#petEnabled').click()");
    await until(() => evaluate("document.querySelector('#petStatus').textContent.includes('小猫已开启') && !document.querySelector('#petEnabled').disabled"));
    let prefs = JSON.parse(await readFile(path.join(profile,'Agenda/window/appearance.json'),'utf8'));
    assert.equal(prefs.petEnabled, true);
    if(process.argv.includes('--reminders')) {
      await evaluate("document.querySelector('[data-page=calendar]').click();document.querySelector('.month-day.future').click()");
      assert(await evaluate("document.querySelector('#dayDialog').open && document.querySelector('#photoActions').hidden"));
      await evaluate("document.querySelector('#addReminder').click();const f=document.querySelector('#reminderForm');f.elements.title.value='Future reminder fixture';f.requestSubmit()");
      await until(()=>evaluate("!document.querySelector('#reminderDialog').open && document.querySelector('.month-reminders').parentElement.parentElement.textContent.includes('Future reminder fixture')"));
      await evaluate("document.querySelector('#dayDialog').close();document.querySelector('[data-view=day]').click()");
      await until(()=>evaluate("Boolean(document.querySelector('.time-slot:not(:disabled)'))"));
      await evaluate("document.querySelector('.time-slot:not(:disabled)').click();document.querySelector('#taskReminder').click()");
      assert(await evaluate("document.querySelector('#reminderForm').elements.time.value===document.querySelector('#taskForm').elements.start.value"));
      await evaluate("document.querySelector('#reminderDialog').close();document.querySelector('#taskDialog').close()");
      const reminderId=await evaluate(`(async()=>{
        const day=(await(await fetch('/api/state')).json()).today;
        const response=await fetch('/api/reminders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:day,title:'Pet bubble reminder fixture',time:'00:00'})});
        return (await response.json()).id;
      })()`);
      await evaluate("window.dispatchEvent(new Event('agenda-reminders-updated'))");
      await until(()=>evaluate(`fetch('/api/state').then(r=>r.json()).then(s=>s.reminders.find(r=>r.id===${JSON.stringify(reminderId)})?.notified===1)`),30000);
      await until(()=>evaluate("!document.querySelector('#calendar').textContent.includes('Pet bubble reminder fixture')"));
      await close();({evaluate}=await open());
      assert(await evaluate(`fetch('/api/state').then(r=>r.json()).then(s=>s.reminders.find(r=>r.id===${JSON.stringify(reminderId)})?.notified===1)`));
      assert(await evaluate("!document.querySelector('#calendar').textContent.includes('Pet bubble reminder fixture')"));
      assert(await evaluate(`fetch('/api/reminders/due').then(r=>r.json()).then(s=>!s.reminders.some(r=>r.id===${JSON.stringify(reminderId)}))`));
      console.log('PASS: future month reminder, date privacy gate, day time prefill, actual pet bubble acknowledgment, restart deduplication');
    }
    if(process.argv.includes('--today')) {
      const mainEvaluate=evaluate, mainSocket=socket;
      await evaluate("document.querySelector('[data-window-action=minimize]').click()");
      await until(()=>evaluate('document.hidden'));
      await evaluate(`(async()=>{
        const state=await fetch('/api/state').then(r=>r.json());
        for(const task of [{title:'阅读示例',start:'09:00',end:'09:45'},{title:'运动示例',start:'15:00',end:'17:00'},{title:'学习示例',start:'10:00',end:'12:00'}]){
          const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...task,date:state.today,note:''})});if(!response.ok)throw Error('fixture task');
        }
        window.dispatchEvent(new Event('agenda-open-today'));
      })()`);
      const port=Number((await readFile(path.join(profile,'Agenda/window/DevToolsActivePort'),'utf8')).split('\n')[0]);
      const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.url.endsWith('/?today')));
      ({evaluate,cdp}=await connect(target));
      await until(()=>evaluate("document.querySelector('#dayDialog')?.open && document.querySelectorAll('#todayTodoList .today-todo-row').length===3"));
      assert.equal(await mainEvaluate('document.hidden'),true,'opening todos must not restore Agenda');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.shell')).display"),'none');
      assert.equal(await evaluate("Boolean(document.querySelector('#boot-sequence-demo'))"),false);
      assert.equal(await evaluate("(()=>{const r=document.querySelector('#dayDialog .close').getBoundingClientRect();return r.width===r.height && getComputedStyle(document.querySelector('#dayDialog .close')).borderRadius==='50%'})()"),true);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.today-todo-title')].map(n=>n.textContent)"),['阅读示例','学习示例','运动示例']);
      assert.equal(await evaluate("Boolean(document.querySelector('#checkinButton'))"),false);
      for(const theme of ['light','dark']){
        await mainEvaluate(`window.agendaAppearance.setTheme('${theme}')`);
        await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`));
        const shot=await cdp('Page.captureScreenshot');await writeFile('.preview/today-'+theme+'.png',Buffer.from(shot.data,'base64'));
      }
      await evaluate(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=3;
        const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'today-fixture.png',{type:'image/png'}));
        document.querySelector('#photoInput').files=transfer.files;document.querySelector('#photoInput').dispatchEvent(new Event('change'));
      })()`);
      await until(()=>evaluate("document.querySelectorAll('#dayPhotos img').length===1"));
      await evaluate("document.querySelector('#todayTodoList input:not(:disabled)').click()");
      await until(()=>evaluate("document.querySelector('#photoHint').textContent.includes('已自动打卡')"));
      assert.equal(await evaluate("document.querySelectorAll('.today-todo-row').length"),3);
      assert.equal(await mainEvaluate('document.hidden'),true);
      socket.send(JSON.stringify({id:999998,method:'Runtime.evaluate',params:{expression:"document.querySelector('[data-close=dayDialog]').click()"}}));
      await until(async()=>!(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(t=>t.url.endsWith('/?today')));
      socket.close();socket=mainSocket;evaluate=mainEvaluate;
      assert.equal(child.exitCode,null,'closing todos must keep Agenda running');
      assert.equal(await evaluate('document.hidden'),true);
      console.log('PASS: independent Today window, main stays minimized, shared photos/check-in, both themes, independent close');
    }
    if(process.argv.includes('--voice')) {
      assert.equal(await evaluate("window.agendaPet.setVoice({enabled:true,speak:true,speaker:174,threshold:300})"),false);
      await evaluate("document.querySelector('#voiceSpeaker').value='17';document.querySelector('#voiceThreshold').value='450';document.querySelector('#voiceSpeak').checked=false;document.querySelector('#voiceSpeaker').dispatchEvent(new Event('change'))");
      await until(async()=>JSON.parse(await readFile(path.join(profile,'Agenda/window/appearance.json'),'utf8')).voice?.speaker===17);
      await evaluate(`(async()=>{
        const original=window.fetch;window.voicePosts=[];
        window.fetch=(url,options)=>{
          if(options?.method==='POST')window.voicePosts.push({url,body:JSON.parse(options.body)});
          if(url==='/api/ai/chat')return Promise.resolve(new Response(JSON.stringify({status:'completed',answer:'模拟回复',drafts:[]})));
          return original(url,options);
        };
        document.querySelector('[data-window-action=minimize]').click();
        window.dispatchEvent(new CustomEvent('agenda-voice-event',{detail:{type:'voice-text',text:'生成学习计划预览'}}));
      })()`);
      await until(()=>evaluate("window.voicePosts.length===1 && !document.querySelector('#chatSend').disabled"));
      assert.equal(await evaluate('document.hidden'),true,'voice reply must not restore main window');
      assert.deepEqual(await evaluate('window.voicePosts.map(x=>x.url)'),['/api/ai/chat']);
      assert.equal(await evaluate('window.voicePosts[0].body.message'),'生成学习计划预览');
      await evaluate("document.querySelector('#chatInput').value='已有草稿';window.dispatchEvent(new CustomEvent('agenda-voice-event',{detail:{type:'voice-text',text:'补充语音'}}))");
      assert.equal(await evaluate('window.voicePosts.length'),1);
      assert.equal(await evaluate("document.querySelector('#chatInput').value"),'已有草稿\n补充语音');
      await evaluate("document.querySelector('[data-page=settings]').click();document.querySelector('#voicePreview').click()");
      await until(()=>evaluate("document.querySelector('#voiceStatus').textContent==='试听已完成'"));
      await evaluate("document.querySelector('#voiceEnabled').click()");
      await until(()=>evaluate("document.querySelector('#voiceStatus').textContent==='本地监听中，说“你好”唤醒'"));
      await evaluate("document.querySelector('#voiceEnabled').click()");
      await until(()=>evaluate("document.querySelector('#voiceStatus').textContent==='麦克风已关闭'"));
    }
    await evaluate("window.agendaPet.state('working');window.agendaPet.state('done')");
    await close();
    ({evaluate} = await open());
    await until(() => evaluate("document.querySelector('#petStatus').textContent.includes('小猫已开启')"));
    assert.equal(await evaluate("document.querySelector('#petEnabled').checked"), true);
    await evaluate("document.querySelector('[data-page=settings]').click();document.querySelector('#petEnabled').click()");
    await until(() => evaluate("document.querySelector('#petStatus').textContent.includes('小猫已关闭') && !document.querySelector('#petEnabled').disabled"));
    prefs = JSON.parse(await readFile(path.join(profile,'Agenda/window/appearance.json'),'utf8'));
    assert.equal(prefs.petEnabled, false);
    await close();
    console.log('PASS: packaged pet starts, AI state pipe, toggle persists on restart, disable and application exit close pet');
  } else if (process.argv.includes('--preferences')) {
    let {cdp,evaluate} = await open();
    assert.equal(await evaluate("document.querySelector('.month-day.is-today .day-checked').textContent"), '😢');
    assert.equal(await evaluate("document.querySelectorAll('.month-day:not(.is-today) .day-checked').length"), 0);
    await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const state=await fetch('/api/state').then(r=>r.json());
      const photo=await fetch('/api/photos/'+state.today,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob});
      if(!photo.ok)throw Error('photo failed');
      await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:state.today,title:'Check-in fixture',start:'09:00',end:'10:00'})});
      const tasks=await fetch('/api/state').then(r=>r.json());
      const check=await fetch('/api/tasks/done',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tasks.tasks[0].id})});
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
  // Synthetic preview exercises the shipped renderer; backend scheduling is checked separately.
  await evaluate(`(async()=>{
    const original=window.fetch, state=await (await original('/api/ai/state')).json();
    const spec={from_date:'2026-09-14',to_date:'2026-09-20',rules:[{title:'运动示例',per_week:4,minutes:120,until:'2026-12-20',skip_courses:[]}],windows:[{start:'08:30',end:'21:00'}],blocked:[]};
    state.proposals=[{id:'renderer-fixture',kind:'plan',status:'pending',body:{title:'规则预览示例',mode:'普通',deadline:'2026-12-20',topics:[],sessions:[],schedule_request:spec}}];
    window.fetch=(url,...args)=>String(url)==='/api/ai/state'?Promise.resolve(new Response(JSON.stringify(state))):original(url,...args);
    window.restoreScheduleFetch=()=>{window.fetch=original;delete window.restoreScheduleFetch;window.dispatchEvent(new Event('agenda-ai-open'));};
    window.dispatchEvent(new Event('agenda-ai-open'));
  })()`);
  await until(() => evaluate("document.querySelector('#aiProposals').textContent.includes('每周 4 次')"));
  assert(await evaluate("document.querySelector('#aiProposals').textContent.includes('每次连续 120 分钟')"));
  assert(await evaluate("document.querySelector('#aiProposals').textContent.includes('08:30–21:00')"));
  assert.equal(await evaluate("document.querySelector('#aiProposals button').textContent"),'确认执行');
  await evaluate('window.restoreScheduleFetch()');
  await until(() => evaluate("document.querySelector('#aiProposals').children.length===0"));
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
