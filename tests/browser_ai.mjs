// Real browser and app HTTP; tests/serve_ai_fixture.py supplies a simulated model.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8767';
const list=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const socket=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
let id=0;const pending=new Map(),errors=[];
socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){const end=Date.now()+10000;while(Date.now()<end){if(await ev(expression))return;await new Promise(r=>setTimeout(r,60));}throw Error(expression);}
const getState=async()=>await(await fetch(base+'/api/state')).json();
async function send(text){await ev(`document.querySelector('#chatInput').value=${JSON.stringify(text)};document.querySelector('#chatForm').requestSubmit()`);await until("!document.querySelector('#chatSend').disabled && document.querySelector('.proposal')");}
try{
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:base});await until("document.querySelector('#aiStatus') && document.querySelector('.month-day.is-today:not(:disabled)')");
 await ev("document.querySelector('[data-page=settings]').click();document.querySelector('#modelSettings').open=true");
 await until("!document.querySelector('#settingsPage').hidden");
 await ev("if(document.querySelector('#aiConfigForm').hidden)document.querySelector('.configured-model .model-actions button').click()");
 await ev("const f=document.querySelector('#aiConfigForm');f.elements.api_key.value='fixture-key';f.requestSubmit()");
 await until("document.querySelector('#aiStatus').textContent==='deepseek-chat'");
 assert.match(await ev("document.querySelector('#aiStatus').title"),/DeepSeek Harness 0\.1\.5-rc\.2/);
 assert.equal(await ev("document.querySelector('#aiConfigForm').elements.api_key.value"),'');
 await ev("document.querySelector('[data-page=ai]').click()");
 await until("!document.querySelector('#aiPage').hidden");
 await send('plan');assert.equal((await getState()).tasks.length,0);
 await ev("document.querySelector('.proposal .primary').click()");await until("!document.querySelector('.proposal')");
 assert.equal((await getState()).tasks.length,1);
 const {root}=await cdp('DOM.getDocument');const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'#chatFile'});
 await cdp('DOM.setFileInputFiles',{nodeId,files:[process.cwd().replaceAll('\\','/')+'/.preview/sample.xlsx']});
 await until("document.querySelector('#chatAttachment').textContent.includes('172')");
 await send('import');assert.equal((await getState()).tasks.length,1);
 await ev("document.querySelector('.proposal .primary').click()");await until("!document.querySelector('.proposal')");assert.equal((await getState()).tasks.length,173);
 await send('delete');await ev("document.querySelector('.proposal .primary').click()");await until("!document.querySelector('.proposal')");assert.equal((await getState()).tasks.length,1);
 await cdp('Page.reload');await until("document.querySelector('#aiStatus')?.textContent==='deepseek-chat'");await ev("document.querySelector('[data-page=ai]').click()");
 assert.equal(await ev("document.querySelector('#extendGoal')"),null);
 await ev("document.querySelector('#profilePanel').open=true;document.querySelector('#generateProfile').click()");
 await until("!document.querySelector('#generateProfile').disabled && document.querySelector('#profileContent').textContent.includes('已生成的学习画像')");
 assert.match(await ev("document.querySelector('#profileContent').textContent"),/数据不足/);
 await cdp('Page.reload');await until("document.querySelector('#profileContent')?.textContent.includes('已生成的学习画像')");
 await ev("document.querySelector('[data-page=ai]').click();document.querySelector('#profilePanel').open=true");
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile('.preview/ai-desktop.png',Buffer.from(shot.data,'base64'));
 await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
 assert(await ev('document.documentElement.scrollWidth<=innerWidth'));
 const mobile=await cdp('Page.captureScreenshot',{format:'png'});await writeFile('.preview/ai-mobile.png',Buffer.from(mobile.data,'base64'));
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: skill/tool loop with simulated provider, chat config, plan preview/apply, XLSX attachment/import/delete, reload, 375px, no browser exceptions.');
}finally{socket.close();}
