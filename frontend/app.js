import {t, language, applyStaticLanguage} from './i18n.js';
import {keyOf,fromKey,plusDays,weekStart,minutes,timeOf,canRecord,canEdit,monthCells,navigate,eventLayout} from './calendar.js';

const $ = (s) => document.querySelector(s);
let pageTransition;
function turnPage(update) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update(); return;
  }
  pageTransition?.skipTransition();
  pageTransition = document.startViewTransition(update);
}
function setSidebar(collapsed){
  $('.shell').classList.toggle('sidebar-collapsed',collapsed);
  const toggle=$('#sidebarToggle'),label=collapsed?t('展开侧栏'):t('收起侧栏');
  toggle.title=label;toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-expanded',String(!collapsed));
}
document.querySelectorAll('.nav-item').forEach(b=>{const label=b.querySelector('span:last-child').firstChild.textContent;b.title=label;b.setAttribute('aria-label',label);});
try{setSidebar(localStorage.getItem('agenda.sidebarCollapsed')==='true');}catch{setSidebar(false);}
$('#sidebarToggle').onclick=()=>{const collapsed=!$('.shell').classList.contains('sidebar-collapsed');setSidebar(collapsed);try{localStorage.setItem('agenda.sidebarCollapsed',String(collapsed));}catch{}};
let weekNames = [t('周日'),t('周一'),t('周二'),t('周三'),t('周四'),t('周五'),t('周六')];
const state = {today:keyOf(new Date()),anchor:keyOf(new Date()),view:'month',page:'calendar',tasks:[],photos:[],checkins:[],visits:[],day:null,ready:false};
const node = (tag,cls,text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const button = (cls,text,fn) => {const b=node('button',cls,text); b.type='button'; b.onclick=fn;return b;};
function toast(text) {$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
async function api(path,body,raw=false) {
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json',...(raw&&body.name?{'X-Filename':encodeURIComponent(body.name)}:{})},body:raw?body:JSON.stringify(body)});
  const result=await response.json(); if(!response.ok)throw new Error(result.error||t('保存失败')); return result;
}
async function refresh() {
  const data=await api('/api/state'); Object.assign(state,data,{ready:true});
  $('#connection').hidden=true;render();
}
function render() {
  $('#computerDate').textContent=t`${state.today} · 电脑本地日期`;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
  renderCalendar();renderCheckins();if($('#dayDialog').open)renderDay();
}
function setPage(page) {
  state.page=page; document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==page+'Page');
  document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#breadcrumb').textContent={calendar:t('我的日历'),import:t('导入课表'),checkins:t('打开与打卡'),ai:'AI',settings:t('设置')}[page];
  if(page==='ai')window.dispatchEvent(new Event('agenda-ai-open'));
}
function renderCalendar() {
  const d=fromKey(state.anchor), area=$('#calendar');area.replaceChildren();
  const start=state.view==='week'?weekStart(state.anchor):state.anchor;
  $('#calendarTitle').textContent=language==='en'?d.toLocaleDateString('en-US',state.view==='day'?{month:'long',day:'numeric'}:{month:'long',year:'numeric'}):state.view==='day'?t`${d.getMonth()+1}月${d.getDate()}日`:t`${d.getFullYear()}年 ${d.getMonth()+1}月`;
  $('#calendarSubtitle').textContent=state.view==='month'?t('把日子铺开，把今天留下。'):state.view==='week'?t`${start} — ${plusDays(start,6)} · 点击空白时段添加安排`:t`${weekNames[d.getDay()]} · 点击空白时段添加安排`;
  $('#calendarHint').textContent=state.view==='month'?t('过去可回看，今天可记录'):t('点击任务编辑 · 历史日程只读');
  if(state.view==='month') {
    const weekdays=node('div','weekdays');weekNames.forEach(day=>weekdays.append(node('span','',day)));area.append(weekdays);
    const grid=node('div','month-grid');
    for(const cell of monthCells(state.anchor)) {
      const photos=state.photos.filter(p=>p.date===cell.date),checked=state.checkins.some(c=>c.date===cell.date);
      const b=button(`month-day ${cell.outside?'outside':''} ${cell.date===state.today?'is-today':''} ${cell.date>state.today?'future':''}`,'',()=>openDay(cell.date));
      b.dataset.date=cell.date;b.disabled=cell.date>state.today||!state.ready;
      b.setAttribute('aria-label',`${cell.date}${checked?t(' 已打卡'):cell.date<=state.today?t(' 未打卡'):''}${photos.length?t` ${photos.length}张照片`:''}${cell.date>state.today?t(' 尚未开放'):''}`);
      b.append(node('span','day-number',String(fromKey(cell.date).getDate())));
      if(cell.date===state.today){const face=node('span','day-checked '+(checked?'checked':'unchecked'),checked?'😊':'😢');face.setAttribute('aria-hidden','true');b.append(face);}
      if(photos.length){const img=node('img','month-thumb');img.src='/photos/'+photos[0].filename;img.alt=t`${cell.date}的照片`;img.loading='lazy';b.append(img);}
      const count=state.tasks.filter(t=>t.date===cell.date).length;
      if(photos.length)b.append(node('span','month-tag',t`${photos.length} 张照片`));
      else if(count)b.append(node('span','month-tag',t`${count} 项安排`));
      grid.append(b);
    }
    area.append(grid);return;
  }
  const count=state.view==='week'?7:1,dates=Array.from({length:count},(_,i)=>plusDays(start,i));
  const relevant=state.tasks.filter(t=>dates.includes(t.date));
  const begin=Math.min(510,...relevant.map(t=>Math.floor(minutes(t.start)/30)*30)),end=1440;
  const scroll=node('div','time-scroll');scroll.style.setProperty('--days',String(count));scroll.style.setProperty('--minimum',count===7?'730px':'250px');
  const header=node('div','time-header');header.append(node('div','',`${timeOf(begin)}\n24:00`));
  dates.forEach(day=>{const b=button(day===state.today?'current':'','',()=>turnPage(()=>{state.anchor=day;state.view='day';render();}));b.append(node('span','',weekNames[fromKey(day).getDay()]),node('strong','',String(fromKey(day).getDate())));header.append(b);});
  scroll.append(header);const grid=node('div','time-grid');const labels=node('div','time-labels');labels.style.height=(end-begin)+'px';
  for(let m=begin;m<=end;m+=30){const label=node('span','',timeOf(m));label.style.top=(m-begin)+'px';labels.append(label);}grid.append(labels);
  dates.forEach(day=>{
    const track=node('div','day-track');track.style.height=(end-begin)+'px';
    for(let m=begin;m<end;m+=30){const slot=button('time-slot','',()=>openTask(null,day,timeOf(m)));slot.style.top=(m-begin)+'px';slot.disabled=!canEdit(day,state.today)||!state.ready;slot.setAttribute('aria-label',t`${day} ${timeOf(m)} 添加任务`);track.append(slot);}
    for(const t of eventLayout(relevant.filter(t=>t.date===day))){
      const event=button('event '+(t.origin?'imported':''),'',()=>openTask(t));event.dataset.task=t.id;event.style.top=(minutes(t.start)-begin)+'px';event.style.height=Math.max(24,minutes(t.end)-minutes(t.start))+'px';event.style.left=`calc(${100*t.lane/t.lanes}% + 3px)`;event.style.width=`calc(${100/t.lanes}% - 6px)`;
      event.append(node('strong','',t.title),node('small','',`${t.start}–${t.end}`));if(t.note)event.append(node('small','',t.note));event.title=`${t.title}\n${t.start}–${t.end}\n${t.note}`;track.append(event);
    }
    if(day===state.today){const now=new Date(),m=now.getHours()*60+now.getMinutes();if(m>=begin&&m<end){const line=node('div','now-line');line.style.top=(m-begin)+'px';track.append(line);}}
    grid.append(track);
  });scroll.append(grid);area.append(scroll);
}
async function openDay(day) {
  if(!state.ready||day>state.today)return;state.day=day;$('#dayError').textContent='';renderDay();$('#dayDialog').showModal();
}
function renderDay() {
  const day=state.day,photos=state.photos.filter(p=>p.date===day),checked=state.checkins.some(c=>c.date===day),current=canRecord(day,state.today);
  const d=fromKey(day);$('#dayTitle').textContent=t`${d.getMonth()+1}月${d.getDate()}日 · ${weekNames[d.getDay()]}`;
  $('#dayState').textContent=`${checked?t('✓ 已完成打卡'):t('尚未打卡')}${current?t(' · 记录今天'):t(' · 历史记录，只可查看')}`;
  const list=$('#dayPhotos');list.replaceChildren();
  if(!photos.length)list.append(node('div','empty-photos',current?t('今天还没有照片，留下一点生活的痕迹。'):t('这一天没有留下照片。')));
  photos.forEach(p=>{const link=node('a');link.href='/photos/'+p.filename;link.target='_blank';link.rel='noopener';const img=node('img');img.src=link.href;img.alt=t`${day}照片，点击查看大图`;link.append(img);list.append(link);});
  $('#photoActions').hidden=!current;$('#photoInput').disabled=Boolean(state.photoBusy);$('#checkinButton').disabled=checked||!photos.length||Boolean(state.photoBusy);
  $('#checkinButton').textContent=checked?t('✓ 今日已打卡'):t('完成今日打卡');$('#photoHint').textContent=photos.length?t('照片已保存在这台电脑，历史记录会自动锁定。'):t('先上传至少一张当天照片，才能完成打卡。');
}
function renderCheckins() {
  $('#openCount').replaceChildren(document.createTextNode(String(state.visits.length)),node('small','',t('天')));
  $('#checkCount').replaceChildren(document.createTextNode(String(state.checkins.length)),node('small','',t('天')));
  $('#todayStatus').textContent=state.checkins.some(c=>c.date===state.today)?t('已打卡 ✓'):t('等待一张照片');
  const list=$('#visitList');list.replaceChildren();const dates=[...new Set([...state.visits.map(v=>v.date),...state.checkins.map(c=>c.date),...state.photos.map(p=>p.date)])].sort().reverse();
  if(!dates.length)list.append(node('p','muted',t('打开日历后，记录会从今天开始。')));
  dates.forEach(day=>{const row=node('div','visit-row');row.append(node('strong','',day),node('span','',state.checkins.some(c=>c.date===day)?t('✓ 已打卡'):t('已打开 · 未打卡')),button('',t('查看'),()=>openDay(day)));list.append(row);});
}
function openTask(task,day=state.anchor,start='08:30') {
  const f=$('#taskForm');f.reset();$('#taskError').textContent='';const editable=canEdit(task?.date||day,state.today)&&!task?.done&&!task?.goal_id;
  $('#taskTitle').textContent=task?.done?t('已完成 · 只读'):task?.goal_id?t('学习安排 · 在 AI 中重排'):editable?(task?t('编辑安排'):t('安排一件事')):t('历史安排 · 只读');
  const values=task||{id:'',title:'',date:day,start,end:timeOf(Math.min(1440,minutes(start)+60)),note:''};
  f.elements.end.replaceChildren();for(let m=5;m<=1440;m+=5){const option=node('option','',timeOf(m));option.value=timeOf(m);f.elements.end.append(option);}if(values.end&&minutes(values.end)%5){const option=node('option','',values.end);option.value=values.end;f.elements.end.append(option);}
  for(const key of ['id','title','date','start','end','note'])f.elements[key].value=values[key]||'';
  for(const key of ['title','date','start','end','note'])f.elements[key].disabled=!editable;
  f.elements.date.min=state.today;$('#saveTask').hidden=!editable;$('#deleteTask').hidden=!task||!editable;$('#taskDialog').showModal();
  $('#completeTask').hidden=!task||task.date!==state.today||!!task.done||!!task.origin;
  $('#completeTask').textContent=t('完成任务');
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>turnPage(()=>setPage(b.dataset.page)));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>turnPage(()=>{state.view=b.dataset.view;render();}));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
$('#prev').onclick=()=>turnPage(()=>{state.anchor=navigate(state.anchor,state.view,-1);render();});
$('#next').onclick=()=>turnPage(()=>{state.anchor=navigate(state.anchor,state.view,1);render();});
$('#today').onclick=()=>turnPage(()=>{state.anchor=state.today;render();});
$('#taskForm').onsubmit=async e=>{e.preventDefault();const b=$('#saveTask');b.disabled=true;$('#taskError').textContent='';try{const fields=Object.fromEntries(new FormData(e.target));await api('/api/tasks',fields);await refresh();$('#taskDialog').close();toast(t('安排已保存'));}catch(error){$('#taskError').textContent=error.message;}finally{b.disabled=false;}};
$('#deleteTask').onclick=async()=>{const id=$('#taskForm').elements.id.value;if(!confirm(t('删除这项安排？')))return;try{await api('/api/tasks/delete',{id});await refresh();$('#taskDialog').close();toast(t('安排已删除'));}catch(error){$('#taskError').textContent=error.message;}};
$('#completeTask').onclick=async()=>{const b=$('#completeTask');b.disabled=true;try{await api('/api/tasks/done',{id:$('#taskForm').elements.id.value});await refresh();$('#taskDialog').close();toast(t('任务已完成'));}catch(error){$('#taskError').textContent=error.message;}finally{b.disabled=false;}};
window.addEventListener('agenda-refresh',()=>refresh().catch(e=>toast(e.message)));
$('#photoInput').onchange=async e=>{
  const files=[...e.target.files],day=state.day;if(!files.length)return;state.photoBusy=true;renderDay();$('#dayError').textContent='';let saved=0;
  try{for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(t('请选择 JPG、PNG 或 WebP 照片'));if(file.size>12*1024*1024)throw new Error(t('单张照片不能超过 12MB'));await api('/api/photos/'+day,file,true);saved++;}toast(t`已保存 ${saved} 张照片`);}catch(error){$('#dayError').textContent=`${saved?t`已保存 ${saved} 张；`:''}${error.message}`;}finally{state.photoBusy=false;e.target.value='';try{await refresh();}catch(error){$('#dayError').textContent=error.message;}renderDay();}
};
$('#checkinButton').onclick=async()=>{const b=$('#checkinButton');b.disabled=true;try{await api('/api/checkin',{date:state.day});await refresh();toast(t('今天的打卡已完成 ✓'));}catch(error){$('#dayError').textContent=error.message;renderDay();}};
$('#xlsx').onchange=e=>{$('#importFilename').textContent=e.target.files[0]?.name||'';$('#importResult').textContent='';};
$('#importForm').onsubmit=async e=>{
  e.preventDefault();const file=$('#xlsx').files[0];if(!file)return;const b=$('#importButton');b.disabled=true;$('#importResult').textContent=t('正在读取课表…');
  try{if(!/\.xlsx$/i.test(file.name))throw new Error(t('请选择 .xlsx 文件'));if(file.size>12*1024*1024)throw new Error(t('课表不能超过 12MB'));const result=await api('/api/import',file,true);await refresh();$('#importResult').textContent=t`已导入 ${result.added} 项安排${result.skipped?t`，跳过 ${result.skipped} 项重复记录`:''}。日期：${result.from} 至 ${result.to}。可在日历周 / 日视图查看和编辑。`;toast(t('课表已放进日历'));}catch(error){$('#importResult').textContent=error.message;}finally{b.disabled=false;}
};
async function boot(){try{await api('/api/open',{});await refresh();}catch(error){$('#connection').hidden=false;$('#connection').textContent=t('无法连接本地保存服务，请启动 scripts/run-local.bat 后刷新页面。')+error.message;}}
render();boot();
// Recheck the computer's date on return and across midnight; server repeats write checks.
setInterval(async()=>{if(keyOf(new Date())!==state.today){try{await api('/api/open',{});await refresh();}catch{}}},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)boot();});

// Appearance is saved by the desktop host because its private port changes on restart.
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  document.querySelectorAll('[name=agendaTheme]').forEach(input=>input.checked=input.value===theme);
  document.querySelector('meta[name=theme-color]').content=theme==='dark'?'#1b1d22':'#d9eaf4';
}
applyTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');
document.querySelectorAll('[name=agendaTheme]').forEach(input=>input.addEventListener('change',async()=>{
  if(!input.checked)return;
  const previous=document.documentElement.dataset.theme,theme=input.value;
  try{
    if(window.agendaAppearance){if(!await window.agendaAppearance.setTheme(theme))throw Error('save');try{localStorage.setItem('agenda.theme',theme);}catch{}}
    else localStorage.setItem('agenda.theme',theme);
    applyTheme(theme);$('#appearanceStatus').textContent=t('已保存外观设置');
  }catch{applyTheme(previous);$('#appearanceStatus').textContent=t('外观保存失败，请重试。');}
}));
const fallingStars=document.createElement('div');fallingStars.className='falling-stars';fallingStars.setAttribute('aria-hidden','true');
for(let i=0;i<32;i++){
  const star=document.createElement('span'),duration=18+Math.random()*16;
  star.style.left=`${2+Math.random()*96}%`;star.style.setProperty('--drift',`${Math.random()*40-20}px`);
  star.style.animationDuration=`${duration}s`;star.style.animationDelay=`${-Math.random()*duration}s`;
  fallingStars.append(star);
}
$('.shell').append(fallingStars);

let preferences = {language, shortBoot: window.agendaAppearance?.shortBoot === true};
if (!window.agendaAppearance) try { preferences.shortBoot = JSON.parse(localStorage.getItem('agenda.preferences') || '{}').shortBoot === true; } catch {}
$('#languageSelect').value = language;
$('#shortBoot').checked = preferences.shortBoot;
async function savePreferences() {
  const next = {language: $('#languageSelect').value, shortBoot: $('#shortBoot').checked};
  $('#languageSelect').disabled = $('#shortBoot').disabled = true;
  try {
    if (window.agendaAppearance) { if (!await window.agendaAppearance.setPreferences(next)) throw Error('save'); }
    else localStorage.setItem('agenda.preferences', JSON.stringify(next));
    preferences = next;
    applyStaticLanguage(next.language);
    weekNames = ['周日','周一','周二','周三','周四','周五','周六'].map(day => t(day));
    setSidebar($('.shell').classList.contains('sidebar-collapsed'));
    document.querySelectorAll('.nav-item').forEach(b => { const label = b.querySelector('span:last-child').firstChild.textContent; b.title = label; b.setAttribute('aria-label', label); });
    setPage(state.page); render();
    window.dispatchEvent(new Event('agenda-language'));
    $('#appearanceStatus').textContent = t('设置已保存，下次打开使用所选开场。');
  } catch {
    $('#languageSelect').value = preferences.language;
    $('#shortBoot').checked = preferences.shortBoot;
    $('#appearanceStatus').textContent = t('设置保存失败，请重试。');
  } finally { $('#languageSelect').disabled = $('#shortBoot').disabled = false; }
}
$('#languageSelect').onchange = $('#shortBoot').onchange = savePreferences;
