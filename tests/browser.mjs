// Isolated Chromium page test; no employee sessions or user browser profiles.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const base=process.env.AGENDA_TEST_URL||'http://127.0.0.1:8766';
const list=await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target=list.find(t=>t.type==='page');
const socket=new WebSocket(target.webSocketDebuggerUrl);let sequence=0;const pending=new Map(),errors=[];
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);};
function cdp(method,params={}) {return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+expression);}
async function files(selector,paths){const {root}=await cdp('DOM.getDocument');const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector});await cdp('DOM.setFileInputFiles',{nodeId,files:paths});}
async function shot(name){const {data}=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('.preview/'+name+'.png',Buffer.from(data,'base64'));}
try {
  await mkdir('.preview',{recursive:true});await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base});await until("document.querySelector('.month-day.is-today') && !document.querySelector('.month-day.is-today').disabled");
  const today=await evaluate("document.querySelector('.month-day.is-today').dataset.date");
  assert.equal(today,(await(await fetch(base+'/api/state')).json()).today);
  assert(await evaluate("[...document.querySelectorAll('.month-day.future')].every(b=>b.disabled)"));
  await shot('calendar-desktop');
  await evaluate("document.querySelector('.month-day.is-today').click()");
  assert(await evaluate("document.querySelector('#checkinButton').disabled"));
  await files('#photoInput',[process.cwd().replaceAll('\\','/')+'/.preview/photo.png']);
  await until("!document.querySelector('#checkinButton').disabled");
  await evaluate("document.querySelector('#checkinButton').click()");await until("document.querySelector('#dayState').textContent.includes('已完成打卡')");
  await shot('today-photo');await evaluate("document.querySelector('[data-close=dayDialog]').click()");
  await evaluate("document.querySelector('.month-day:not(.outside):not(.future):not(.is-today)').click()");
  assert(await evaluate("document.querySelector('#photoActions').hidden"));
  await evaluate("document.querySelector('[data-close=dayDialog]').click();document.querySelector('[data-page=import]').click()");
  await files('#xlsx',[process.cwd().replaceAll('\\','/')+'/.preview/sample.xlsx']);
  await evaluate("document.querySelector('#importForm').requestSubmit()");await until("document.querySelector('#importResult').textContent.includes('已导入')");
  console.log('Import:',await evaluate("document.querySelector('#importResult').textContent"));
  await evaluate("document.querySelector('#importForm').requestSubmit()");await until("document.querySelector('#importResult').textContent.includes('已导入 0 项')");
  await evaluate("document.querySelector('[data-page=calendar]').click();document.querySelector('[data-view=week]').click()");
  assert(await evaluate("document.querySelector('.time-labels').textContent.includes('08:30') && document.querySelector('.time-labels').textContent.includes('24:00')"));
  await shot('calendar-week');
  await evaluate("document.querySelector('.timeline-actions button').click();document.querySelector('#taskForm').elements.title.value='浏览器流程测试';document.querySelector('#taskForm').elements.start.value='22:30';document.querySelector('#taskForm').elements.end.value='24:00';document.querySelector('#taskForm').requestSubmit()");
  await until("!document.querySelector('#taskDialog').open && [...document.querySelectorAll('.event')].some(b=>b.textContent.includes('浏览器流程测试'))");
  await evaluate("[...document.querySelectorAll('.event')].find(b=>b.textContent.includes('浏览器流程测试')).click();document.querySelector('#taskForm').elements.title.value='已修改任务';document.querySelector('#taskForm').requestSubmit()");
  await until("!document.querySelector('#taskDialog').open && [...document.querySelectorAll('.event')].some(b=>b.textContent.includes('已修改任务'))");
  await evaluate("document.querySelector('[data-view=day]').click()");await shot('calendar-day');
  await cdp('Page.reload');await until("document.querySelector('.month-day.is-today img')");
  assert((await(await fetch(base+'/api/state')).json()).tasks.some(t=>t.title==='已修改任务'));
  await evaluate("document.querySelector('[data-page=checkins]').click()");assert.equal(await evaluate("document.querySelector('#openCount').textContent"),'1天');assert.equal(await evaluate("document.querySelector('#checkCount').textContent"),'1天');await shot('checkins');
  await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  for(const page of ['calendar','import','checkins','ai']){
    await evaluate(`document.querySelector('[data-page=${page}]').click()`);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'),page+' overflow');
    if(page==='calendar')await shot('calendar-mobile');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('PASS: real file import, date locks, disk photo upload, check-in, CRUD, reload, opened-day count, desktop/mobile layouts.');
} finally {socket.close();}
