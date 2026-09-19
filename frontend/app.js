import {t, language, applyStaticLanguage} from './i18n.js';
import {keyOf,fromKey,plusDays,weekStart,minutes,timeOf,canRecord,canEdit,monthCells,navigate,eventLayout,completionByDay,checkinSummary,allTimeProgress} from './calendar.js';

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
const state = {today:keyOf(new Date()),anchor:keyOf(new Date()),view:'month',page:'calendar',goals:[],tasks:[],reminders:[],photos:[],checkins:[],visits:[],day:null,ready:false};
const node = (tag,cls,text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const button = (cls,text,fn) => {const b=node('button',cls,text); b.type='button'; b.onclick=fn;return b;};
function toast(text) {$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
const calendarUpdates=new BroadcastChannel('agenda-calendar-updates');
calendarUpdates.onmessage=()=>refresh().catch(error=>toast(error.message));
window.addEventListener('agenda-reminders-updated',()=>refresh().catch(error=>toast(error.message)));
async function api(path,body,raw=false) {
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json',...(raw&&body.name?{'X-Filename':encodeURIComponent(body.name)}:{})},body:raw?body:JSON.stringify(body)});
  const result=await response.json(); if(!response.ok)throw new Error(result.error||t('保存失败'));
  if(body!==undefined&&(path==='/api/diary'||path==='/api/tasks/done'||path.startsWith('/api/photos/')))calendarUpdates.postMessage('saved');
  return result;
}
async function refresh() {
  const data=await api('/api/state');data.reminders=data.reminders.filter(r=>!r.notified); Object.assign(state,data,{ready:true});
  $('#connection').hidden=true;render();
}
function render() {
  $('#computerDate').textContent=t`${state.today} · 电脑本地日期`;
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
  renderCalendar();renderOverview();renderDiary();if($('#dayDialog').open)renderDay();
}
function setPage(page) {
  state.page=page; document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==page+'Page');
  document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#breadcrumb').textContent={calendar:t('我的日历'),overview:t('总览'),diary:t('日记'),import:t('导入课表'),ai:'AI',settings:t('设置')}[page];
  if(page==='ai')window.dispatchEvent(new Event('agenda-ai-open'));
}
let overviewAnchor=keyOf(new Date()),overviewView='month';
function renderOverview() {
  const cells=overviewView==='month'?monthCells(overviewAnchor):Array.from({length:7},(_,i)=>({date:plusDays(weekStart(overviewAnchor),i),outside:false}));
  const dates=cells.filter(c=>!c.outside).map(c=>c.date),completion=completionByDay(state.tasks),d=fromKey(overviewAnchor);
  const scale=Math.max(10,...dates.map(day=>completion.get(day)?.done||0));
  $('#overviewMonth').textContent=overviewView==='week'?`${dates[0]} — ${dates.at(-1)}`:language==='en'?d.toLocaleDateString('en-US',{year:'numeric',month:'long'}):t`${d.getFullYear()}年 ${d.getMonth()+1}月`;
  $('#overviewToday').textContent=t(overviewView==='week'?'本周':'本月');
  $('#overviewPrev').setAttribute('aria-label',t(overviewView==='week'?'上一周':'上个月'));
  $('#overviewNext').setAttribute('aria-label',t(overviewView==='week'?'下一周':'下个月'));
  document.querySelectorAll('[data-overview-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.overviewView===overviewView);b.setAttribute('aria-pressed',String(b.dataset.overviewView===overviewView));});
  const summary=checkinSummary(dates,state.today,state.checkins);
  $('#overviewStreak').textContent=summary.streak;
  $('#overviewRate').textContent=summary.rate===null?'—':summary.rate+'%';
  $('#overviewDays').textContent=t`${summary.active} / ${summary.elapsed} 天`;
  const area=$('#overviewCalendar');area.replaceChildren();
  const weekdays=node('div','weekdays');weekNames.forEach(day=>weekdays.append(node('span','',day)));area.append(weekdays);
  const grid=node('div','completion-grid');
  for(const cell of cells){
    if(cell.outside){const empty=node('div','completion-empty');empty.setAttribute('aria-hidden','true');grid.append(empty);continue;}
    const progress=completion.get(cell.date)||{done:0,total:0},checked=state.checkins.some(c=>c.date===cell.date);
    const b=button('completion-day '+(cell.date===state.today?'is-today ':'')+(checked?'has-checkin':''),'',()=>openDay(cell.date));
    b.dataset.date=cell.date;b.dataset.completed=progress.done;b.disabled=!state.ready;
    b.style.setProperty('--completion-fill',`${progress.done/scale*100}%`);
    const description=`${cell.date} · ${t`已完成 ${progress.done} / ${progress.total}`} · ${t(checked?'已打卡 ✓':'未打卡')}`;
    b.setAttribute('aria-label',description);b.title=description;
    b.onfocus=b.onmouseenter=()=>{$('#heatmapDetail').textContent=description;};grid.append(b);
  }
  area.append(grid);$('#heatmapDetail').textContent=t('色块代表一天，点击查看任务；圆点表示已打卡。');
  const legend=$('#completionLegend');legend.replaceChildren(node('span','',t('少')));
  for(const amount of [0,1,Math.round(scale/3),Math.round(scale*2/3),scale]){
    const sample=node('span','completion-sample');sample.style.setProperty('--completion-fill',`${amount/scale*100}%`);sample.dataset.completed=amount;sample.title=t`${amount} 项完成`;legend.append(sample);
  }
  legend.append(node('span','',t('多')));legend.title=t`0 → ${scale} 项 · 完成越多，颜色越深`;
  const list=$('#overallProgress');list.replaceChildren();
  const groups=allTimeProgress(state.tasks,state.goals);
  $('#progressCount').textContent=t`${groups.filter(g=>g.done===g.total).length} / ${groups.length} 项全部完成`;
  for(const group of groups){
    const row=node('article','progress-row');row.dataset.group=group.key;
    const heading=node('div','progress-heading'),status=node('span','progress-status',group.done===group.total?'✓':'');
    status.setAttribute('aria-label',t(group.done===group.total?'已完成':'进行中'));
    heading.append(status,node('strong','',group.title),node('span','progress-percent',group.percent+'%'));
    const bar=node('div','segmented-progress');bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',group.title);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(group.total));bar.setAttribute('aria-valuenow',String(group.done));bar.setAttribute('aria-valuetext',t`已完成 ${group.done} / ${group.total}`);
    for(let i=0;i<20;i++){const segment=node('span');segment.style.setProperty('--segment-fill',`${Math.max(0,Math.min(1,group.done/group.total*20-i))*100}%`);bar.append(segment);}
    row.append(heading,bar,node('small','muted',t`已完成 ${group.done} / ${group.total}`));list.append(row);
  }
  if(!groups.length)list.append(node('p','muted',t('添加任务或导入课表后，这里会显示全部进度。')));
}
$('#overviewPrev').onclick=()=>turnPage(()=>{overviewAnchor=navigate(overviewAnchor,overviewView,-1);renderOverview();});
$('#overviewNext').onclick=()=>turnPage(()=>{overviewAnchor=navigate(overviewAnchor,overviewView,1);renderOverview();});
$('#overviewToday').onclick=()=>turnPage(()=>{overviewAnchor=state.today;renderOverview();});
document.querySelectorAll('[data-overview-view]').forEach(b=>b.onclick=()=>turnPage(()=>{overviewView=b.dataset.overviewView;renderOverview();}));
let diaryDay=state.today,diaryDirty=false,diaryTimer,diarySavePromise,diaryPhotoIndex=0;
function renderDiary() {
  const date=fromKey(diaryDay),editor=$('#diaryText'),entry=(state.diary_entries||[]).find(e=>e.date===diaryDay);
  $('#diaryDate').value=diaryDay;$('.diary-book').classList.toggle('diary-future',diaryDay>state.today);
  $('#diaryDayNumber').textContent=String(date.getDate()).padStart(2,'0');
  $('#diaryDateHeading').textContent=date.toLocaleDateString(language==='en'?'en-US':'zh-CN',{year:'numeric',month:'long'});
  $('#diaryWeekday').textContent=date.toLocaleDateString(language==='en'?'en-US':'zh-CN',{weekday:'long'});
  $('#diaryCheckin').textContent=state.checkins.some(c=>c.date===diaryDay)?t('✓ 已留下今日打卡'):t('每一天，都值得被记住。');
  const list=$('#diaryTasks');list.replaceChildren();
  for(const task of state.tasks.filter(t=>t.date===diaryDay&&t.done))list.append(node('li','',task.title));
  if(!list.children.length)list.append(node('li','diary-empty',t('完成的小事，会在这里留下印记。')));
  if(editor.dataset.date!==diaryDay||(!diaryDirty&&!diarySavePromise)){
    editor.value=entry?.content||'';editor.dataset.date=diaryDay;editor.dataset.revision=entry?.revision||0;
    $('#diarySaveStatus').textContent=t(diaryDay!==state.today?'历史日记 · 只读':entry?'已保存到本机':'输入后自动保存');
  }
  editor.readOnly=diaryDay!==state.today;editor.disabled=!state.ready||diaryDay>state.today;
  $('#diarySave').hidden=diaryDay!==state.today;$('#diarySave').disabled=!state.ready||Boolean(diarySavePromise);
  $('#diaryAddPhoto').hidden=diaryDay!==state.today;
  renderDiaryPhotos();
}
function renderDiaryPhotos() {
  const photos=state.photos.filter(p=>p.date===diaryDay),stack=$('#diaryPhotoStack');stack.replaceChildren();
  diaryPhotoIndex=photos.length?diaryPhotoIndex%photos.length:0;
  $('#diaryPhotos').disabled=photos.length<2;
  $('#diaryPhotos').setAttribute('aria-label',t('点击相片，查看下一张'));
  for(let depth=Math.min(3,photos.length)-1;depth>=0;depth--){
    const photo=photos[(diaryPhotoIndex+depth)%photos.length],print=node('span','diary-print'),img=node('img');
    print.style.setProperty('--photo-depth',depth);print.style.setProperty('--photo-angle',[-7,7,-13][depth]+'deg');
    img.src='/photos/'+photo.filename;img.alt=depth===0?t('当天的照片'):'';print.append(img,node('span','',diaryDay));stack.append(print);
  }
  if(!photos.length)stack.append(node('span','diary-photo-empty',t('留一张照片，珍藏今天。')));
  $('#diaryPhotoCaption').textContent=photos.length?`${diaryPhotoIndex+1} / ${photos.length} · ${t(photos.length>1?'轻点相片，翻看下一张':'今日留影')}`:'';
}
async function saveDiary() {
  clearTimeout(diaryTimer);
  if(diarySavePromise)return diarySavePromise;
  if(!diaryDirty)return true;
  diarySavePromise=(async()=>{
    const editor=$('#diaryText');$('#diarySave').disabled=true;
    try{
      while(diaryDirty){
        const date=editor.dataset.date,content=editor.value,revision=Number(editor.dataset.revision);
        $('#diarySaveStatus').textContent=t('正在保存…');
        await api('/api/diary',{date,content,revision});
        state.diary_entries=(state.diary_entries||[]).filter(e=>e.date!==date);
        state.diary_entries.push({date,content,revision:revision+1});editor.dataset.revision=revision+1;
        diaryDirty=editor.value!==content;
      }
      $('#diarySaveStatus').textContent=t('已保存到本机');return true;
    }catch(error){$('#diarySaveStatus').textContent=t('保存未成功，文字已保留，请重试');toast(error.message);return false;}
    finally{$('#diarySave').disabled=false;}
  })();
  const saved=await diarySavePromise;diarySavePromise=null;return saved;
}
let diaryTurning=false;
function diaryPageCopy(page,future){
  const copy=page.cloneNode(true);copy.removeAttribute('id');copy.inert=true;copy.setAttribute('aria-hidden','true');
  copy.querySelectorAll('[id]').forEach(n=>{n.dataset.diaryId=n.id;n.removeAttribute('id');});
  copy.querySelectorAll('textarea').forEach((n,i)=>{n.textContent=page.querySelectorAll('textarea')[i].value;});
  copy.querySelectorAll('.diary-turn').forEach(n=>n.remove());
  if(future)copy.querySelectorAll('.diary-kicker,.diary-checkin,h3,.diary-tasks,.diary-photo-area,form,.diary-page-number').forEach(n=>n.style.display='none');
  return copy;
}
async function changeDiaryDay(day){
  if(diaryTurning)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(fromKey(day).getTime())){$('#diaryDate').value=diaryDay;return;}
  diaryTurning=true;
  try{
    if(!await saveDiary()){$('#diaryDate').value=diaryDay;return;}
    if(day===diaryDay)return;
    const book=$('.diary-book'),forward=day>diaryDay;
    // Blank dates must keep the paper size of the populated spread.
    book.style.minHeight=book.offsetHeight+'px';
    const source=$(forward?'.diary-right':'.diary-left'),target=$(forward?'.diary-left':'.diary-right');
    const front=diaryPageCopy(source,diaryDay>state.today),still=diaryPageCopy(target,diaryDay>state.today);
    diaryDay=day;diaryPhotoIndex=0;renderDiary();
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    if(matchMedia('(max-width:760px)').matches){
      await book.animate([{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'ease-out'}).finished;return;
    }
    const geometry={left:source.offsetLeft,top:source.offsetTop,width:source.offsetWidth,height:source.offsetHeight};
    const stillGeometry={left:target.offsetLeft,top:target.offsetTop,width:target.offsetWidth,height:target.offsetHeight};
    const leaf=node('div','diary-leaf'),back=diaryPageCopy(target,diaryDay>state.today);
    leaf.setAttribute('aria-hidden','true');leaf.inert=true;
    for(const [key,value] of Object.entries(geometry))leaf.style[key]=value+'px';
    for(const [key,value] of Object.entries(stillGeometry))still.style[key]=value+'px';
    still.classList.add('diary-still');front.classList.add('diary-leaf-front');back.classList.add('diary-leaf-back');
    leaf.style.transformOrigin=forward?'left center':'right center';
    leaf.append(front,back);book.append(still,leaf);book.classList.add('is-turning');
    const animation=leaf.animate([
      {transform:'rotateY(0deg)'},
      {transform:`rotateY(${forward?-85:85}deg)`,offset:.5},
      {transform:`rotateY(${forward?-180:180}deg)`}
    ],{duration:850,easing:'cubic-bezier(.38,.05,.2,1)',fill:'forwards'});
    try{await animation.finished;}finally{leaf.remove();still.remove();book.classList.remove('is-turning');}
  }finally{diaryTurning=false;}
}
$('#diaryText').oninput=()=>{diaryDirty=true;$('#diarySaveStatus').textContent=t('等待保存…');clearTimeout(diaryTimer);diaryTimer=setTimeout(saveDiary,700);};
$('#diaryForm').onsubmit=event=>{event.preventDefault();saveDiary();};
$('#diaryDate').onchange=event=>changeDiaryDay(event.target.value);
$('#diaryToday').onclick=()=>changeDiaryDay(state.today);
$('#diaryPagePrev').onclick=()=>changeDiaryDay(plusDays(diaryDay,-1));
$('#diaryPageNext').onclick=()=>changeDiaryDay(plusDays(diaryDay,1));
for(const [selector,offset] of [['.diary-left',-1],['.diary-right',1]])$(selector).addEventListener('click',event=>{if(event.target.closest('button,textarea,input,select,a,form')||String(window.getSelection()).trim())return;changeDiaryDay(plusDays(diaryDay,offset));});
$('#diaryPhotos').onclick=()=>{diaryPhotoIndex++;renderDiaryPhotos();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)$('#diaryPhotoStack').animate([{opacity:.35,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'ease-out'});};
$('#diaryAddPhoto').onclick=()=>openDay(diaryDay);
window.addEventListener('beforeunload',event=>{if(diaryDirty){event.preventDefault();event.returnValue='';}});
const completing = new Set();
async function completeTask(task) {
  if (completing.has(task.id) || task.done) return;
  const viewKey=()=>`${state.page}/${state.view}/${state.anchor}/${state.day}`;
  const view=viewKey(),active=document.activeElement;
  const container=active.closest('#dayDialog')?'#dayDialog':'#calendar';
  const scrolls=['.time-scroll','#todayTodoList'].map(selector=>[selector,$(selector)?.scrollTop||0]);
  completing.add(task.id);
  document.querySelectorAll('[data-complete]').forEach(input=>{if(input.dataset.complete===task.id)input.disabled=true;});
  try {
    await api('/api/tasks/done',{id:task.id});
    const current=state.tasks.find(item=>item.id===task.id);if(current)current.done=1;
    await refresh();toast(t('任务已完成'));
  } finally {
    completing.delete(task.id);render();
    if(view===viewKey()){
      for(const [selector,top] of scrolls)if($(selector))$(selector).scrollTop=top;
      if(active.dataset.complete===task.id && document.activeElement===document.body){
        const checkbox=[...document.querySelectorAll(`${container} [data-complete]`)].find(input=>input.dataset.complete===task.id);
        checkbox?.parentElement.focus({preventScroll:true});
      }
    }
  }
}
function completionCheckbox(task) {
  const label=node('label','task-check'),input=node('input');
  label.tabIndex=-1;
  input.type='checkbox';input.checked=Boolean(task.done);input.dataset.complete=task.id;
  input.disabled=task.date!==state.today||Boolean(task.done)||completing.has(task.id);
  const hint=task.done?t('已完成'):task.date===state.today?t('勾选完成'):t('仅当天可勾选');
  input.setAttribute('aria-label',`${hint} · ${task.title}`);label.title=hint;
  input.onchange=async()=>{
    try{await completeTask(task);}catch(error){toast(error.message);if($('#dayDialog').open)$('#dayError').textContent=error.message;}
  };
  label.append(input);return label;
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
      b.dataset.date=cell.date;b.disabled=!state.ready;
      b.setAttribute('aria-label',`${cell.date}${checked?t(' 已打卡'):cell.date<=state.today?t(' 未打卡'):''}${photos.length?t` ${photos.length}张照片`:''}${cell.date>state.today?t(' 尚未开放'):''}`);
      b.append(node('span','day-number',String(fromKey(cell.date).getDate())));
      const reminders=state.reminders.filter(r=>r.date===cell.date);
      b.setAttribute('aria-label',`${cell.date} ${reminders.map(r=>(r.time||'')+' '+r.title).join(' · ')} ${checked?t('已打卡 ✓'):''}`);
      const reminderList=node('span','month-reminders');
      for(const r of reminders.slice(0,2))reminderList.append(node('span','month-reminder','🔔 '+(r.time?r.time+' ':'')+r.title));
      if(reminders.length>2)reminderList.append(node('span','month-reminder',`+${reminders.length-2}`));
      b.append(reminderList);
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
  const reminders=node('div','calendar-reminders');
  for(const day of dates){
    for(const r of state.reminders.filter(r=>r.date===day))reminders.append(button('reminder-chip','🔔 '+day+' '+(r.time||t('当天'))+' · '+r.title,()=>openDay(day)));
  }
  reminders.append(button('reminder-chip',t('＋ 添加提醒'),()=>openReminder(state.anchor)));
  area.append(reminders);
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
      const event=node('article','event '+(t.origin?'imported ':'')+(t.done?'is-done':''));event.dataset.task=t.id;event.style.top=(minutes(t.start)-begin)+'px';event.style.height=Math.max(28,minutes(t.end)-minutes(t.start))+'px';event.style.left=`calc(${100*t.lane/t.lanes}% + 3px)`;event.style.width=`calc(${100/t.lanes}% - 6px)`;
      const details=button('event-details','',()=>openTask(t));details.append(node('strong','',t.title),node('small','',`${t.start}–${t.end}`));if(t.note)details.append(node('small','',t.note));details.title=`${t.title}\n${t.start}–${t.end}\n${t.note||''}`;
      event.append(completionCheckbox(t),details);track.append(event);
    }
    if(day===state.today){const now=new Date(),m=now.getHours()*60+now.getMinutes();if(m>=begin&&m<end){const line=node('div','now-line');line.style.top=(m-begin)+'px';track.append(line);}}
    grid.append(track);
  });scroll.append(grid);area.append(scroll);
}
async function openDay(day, todos=false) {
  if(!state.ready)return;state.day=day;state.dayTodos=todos;$('#dayError').textContent='';renderDay();if(!$('#dayDialog').open)$('#dayDialog').showModal();
}
window.addEventListener('agenda-open-today',async()=>{
  if(window.agendaPet?.openToday){window.agendaPet.openToday();return;}
  try{await refresh();await openDay(state.today,true);}catch(error){toast(error.message);}
});
async function refreshToday(){try{await refresh();await openDay(state.today,true);}catch(error){$('#dayError').textContent=error.message;}}
if(window.agendaToday?.standalone){
  window.addEventListener('agenda-refresh-today',refreshToday);
  window.addEventListener('focus',refreshToday);
  setInterval(()=>{if(!document.hidden)refreshToday();},30000);
  $('#dayDialog').addEventListener('cancel',event=>{event.preventDefault();window.agendaToday.close();});
  $('#dayDialog').addEventListener('close',()=>window.agendaToday.close());
  refreshToday();
}
function renderDay() {
  if(state.dayTodos)state.day=state.today;
  const day=state.day,photos=state.photos.filter(p=>p.date===day),checked=state.checkins.some(c=>c.date===day),current=canRecord(day,state.today);
  const d=fromKey(day);$('#dayTitle').textContent=t`${d.getMonth()+1}月${d.getDate()}日 · ${weekNames[d.getDay()]}`;
  const reminders=$('#dayReminders');reminders.replaceChildren();
  for(const r of state.reminders.filter(r=>r.date===day)){
    const row=node('div','reminder-row');row.append(node('span','', '🔔 '+(r.time||t('当天'))+' · '+r.title));
    if(day>=state.today)row.append(button('',t('删除'),async()=>{try{await api('/api/reminders/delete',{id:r.id});await refresh();}catch(e){$('#dayError').textContent=e.message;}}));
    reminders.append(row);
  }
  $('#addReminder').hidden=day<state.today;
  $('#dayDialog').classList.toggle('today-panel',Boolean(state.dayTodos));
  $('#todayTodos').hidden=false;
  {
    const tasks=state.tasks.filter(task=>task.date===day).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
    const done=tasks.filter(task=>task.done).length;
    $('#todayTodosTitle').textContent=t`待办 ${tasks.length-done} 项 · 已完成 ${done} / ${tasks.length}`;
    const list=$('#todayTodoList');list.replaceChildren();
    for(const task of tasks){
      const row=node('article','today-todo-row '+(task.done?'is-done':''));
      row.append(completionCheckbox(task),node('time','today-todo-time',`${task.start}–${task.end}`),node('span','today-todo-title',task.title));list.append(row);
    }
    if(!tasks.length)list.append(node('p','muted',t('这一天没有任务安排。')));
  }
  $('#dayState').textContent=day>state.today?t('未来提醒 · 照片与打卡当天开放'):`${checked?t('✓ 已完成打卡'):t('尚未打卡')}${current?t(' · 记录今天'):t(' · 历史记录，只可查看')}`;
  const list=$('#dayPhotos');list.replaceChildren();
  if(!photos.length)list.append(node('div','empty-photos',current?t('今天还没有照片，留下一点生活的痕迹。'):t('这一天没有留下照片。')));
  photos.forEach(p=>{const link=node('a');link.href='/photos/'+p.filename;link.target='_blank';link.rel='noopener';const img=node('img');img.src=link.href;img.alt=t`${day}照片，点击查看大图`;link.append(img);list.append(link);});
  $('#photoActions').hidden=!current;$('#photoInput').disabled=Boolean(state.photoBusy);
  $('#photoHint').textContent=checked?t('✓ 今日已自动打卡'):!photos.length?t('完成至少一项当天任务，并上传照片后自动打卡。'):t('照片已保存，再勾选完成一项当天任务即可自动打卡。');
}
function openTask(task,day=state.anchor,start='08:30') {
  const f=$('#taskForm');f.reset();$('#taskError').textContent='';const editable=canEdit(task?.date||day,state.today)&&!task?.done&&!task?.goal_id;
  $('#taskTitle').textContent=task?.done?t('已完成 · 只读'):task?.goal_id?t('学习安排 · 在 AI 中重排'):editable?(task?t('编辑安排'):t('安排一件事')):t('历史安排 · 只读');
  const values=task||{id:'',title:'',date:day,start,end:timeOf(Math.min(1440,minutes(start)+60)),note:''};
  f.elements.end.replaceChildren();for(let m=5;m<=1440;m+=5){const option=node('option','',timeOf(m));option.value=timeOf(m);f.elements.end.append(option);}if(values.end&&minutes(values.end)%5){const option=node('option','',values.end);option.value=values.end;f.elements.end.append(option);}
  for(const key of ['id','title','date','start','end','note'])f.elements[key].value=values[key]||'';
  for(const key of ['title','date','start','end','note'])f.elements[key].disabled=!editable;
  f.elements.date.min=state.today;$('#saveTask').hidden=!editable;$('#deleteTask').hidden=!task||!editable;$('#taskDialog').showModal();
  $('#completeTask').hidden=!task||task.date!==state.today||!!task.done;
  $('#completeTask').textContent=t('完成任务');
  $('#taskReminder').hidden=!editable;
}

function openReminder(day,clock='',title=''){
  const f=$('#reminderForm');f.reset();f.elements.date.min=state.today;
  f.elements.date.value=day;f.elements.time.value=clock;f.elements.title.value=title;
  $('#reminderError').textContent='';$('#reminderDialog').showModal();
}
$('#addReminder').onclick=()=>openReminder(state.day);
$('#taskReminder').onclick=()=>{const f=$('#taskForm');openReminder(f.elements.date.value,f.elements.start.value,f.elements.title.value);};
$('#reminderForm').onsubmit=async event=>{
  event.preventDefault();const b=event.target.querySelector('.primary');b.disabled=true;
  try{await api('/api/reminders',Object.fromEntries(new FormData(event.target)));await refresh();$('#reminderDialog').close();toast(t('提醒已保存'));}
  catch(error){$('#reminderError').textContent=error.message;}finally{b.disabled=false;}
};
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>turnPage(()=>setPage(b.dataset.page)));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>turnPage(()=>{state.view=b.dataset.view;render();}));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
$('#prev').onclick=()=>turnPage(()=>{state.anchor=navigate(state.anchor,state.view,-1);render();});
$('#next').onclick=()=>turnPage(()=>{state.anchor=navigate(state.anchor,state.view,1);render();});
$('#today').onclick=()=>turnPage(()=>{state.anchor=state.today;render();});
$('#taskForm').onsubmit=async e=>{e.preventDefault();const b=$('#saveTask');b.disabled=true;$('#taskError').textContent='';try{const fields=Object.fromEntries(new FormData(e.target));await api('/api/tasks',fields);await refresh();$('#taskDialog').close();toast(t('安排已保存'));}catch(error){$('#taskError').textContent=error.message;}finally{b.disabled=false;}};
$('#deleteTask').onclick=async()=>{const id=$('#taskForm').elements.id.value;if(!confirm(t('删除这项安排？')))return;try{await api('/api/tasks/delete',{id});await refresh();$('#taskDialog').close();toast(t('安排已删除'));}catch(error){$('#taskError').textContent=error.message;}};
$('#completeTask').onclick=async()=>{const b=$('#completeTask');b.disabled=true;try{const task=state.tasks.find(t=>t.id===$('#taskForm').elements.id.value);if(!task)throw Error(t('请刷新后重试'));await completeTask(task);$('#taskDialog').close();}catch(error){$('#taskError').textContent=error.message;}finally{b.disabled=false;}};
window.addEventListener('agenda-refresh',()=>refresh().catch(e=>toast(e.message)));
$('#photoInput').onchange=async e=>{
  const files=[...e.target.files],day=state.day;if(!files.length)return;state.photoBusy=true;renderDay();$('#dayError').textContent='';let saved=0;
  try{for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(t('请选择 JPG、PNG 或 WebP 照片'));if(file.size>12*1024*1024)throw new Error(t('单张照片不能超过 12MB'));await api('/api/photos/'+day,file,true);saved++;}toast(t`已保存 ${saved} 张照片`);}catch(error){$('#dayError').textContent=`${saved?t`已保存 ${saved} 张；`:''}${error.message}`;}finally{state.photoBusy=false;e.target.value='';try{await refresh();}catch(error){$('#dayError').textContent=error.message;}renderDay();}
};
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
window.addEventListener('focus',()=>{if(!window.agendaToday?.standalone)refresh().catch(e=>toast(e.message));});

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

$('#petEnabled').checked = window.agendaPet?.enabled === true;
$('#petEnabled').disabled = !window.agendaPet;
if (!window.agendaPet) $('#petStatus').textContent = t('桌面宠物仅在 Windows 安装版中可用。');
$('#petEnabled').onchange = async () => {
  const input = $('#petEnabled'), wanted = input.checked;
  input.disabled = true;
  $('#petStatus').textContent = t('正在更新宠物…');
  try {
    if (!await window.agendaPet.setEnabled(wanted)) throw Error('pet');
    input.checked = wanted;
    $('#petStatus').textContent = t(wanted ? '小猫已开启，双击可打开 AI。' : '小猫已关闭。');
  } catch { input.checked = false; $('#petStatus').textContent = t('宠物启动或设置保存失败，请重试。'); }
  finally { input.disabled = false; }
};
window.addEventListener('agenda-pet-changed', event => {
  $('#petEnabled').checked = event.detail.enabled === true;
  $('#petStatus').textContent = t(event.detail.failed ? '宠物启动或设置保存失败，请重试。' : event.detail.enabled ? '小猫已开启，双击可打开 AI。' : '小猫已关闭。');
});

let voicePreferences = window.agendaPet?.voice || {enabled:false,speak:true,speaker:21,threshold:300};
for(let i=0;i<174;i++){const option=document.createElement('option');option.value=i;option.textContent=String(i);$('#voiceSpeaker').append(option);}
function showVoicePreferences(){
  $('#voiceEnabled').checked=voicePreferences.enabled;$('#voiceSpeak').checked=voicePreferences.speak;
  $('#voiceSpeaker').value=voicePreferences.speaker;$('#voiceThreshold').value=voicePreferences.threshold;
  for(const id of ['voiceEnabled','voiceSpeak','voiceSpeaker','voiceThreshold','voicePreview'])$('#'+id).disabled=!window.agendaPet||!$('#petEnabled').checked;
}
showVoicePreferences();
window.addEventListener('agenda-pet-changed',showVoicePreferences);
async function saveVoicePreferences(){
  const next={enabled:$('#voiceEnabled').checked,speak:$('#voiceSpeak').checked,speaker:Number($('#voiceSpeaker').value),threshold:Number($('#voiceThreshold').value)};
  if(!Number.isInteger(next.threshold)||next.threshold<100||next.threshold>3000){$('#voiceStatus').textContent=t('收音门槛须为 100–3000。');return;}
  try{if(!await window.agendaPet.setVoice(next))throw Error('voice');voicePreferences=next;$('#voiceStatus').textContent=t(next.enabled?'语音设置已保存，正在本地监听。':'麦克风已关闭');}
  catch{$('#voiceStatus').textContent=t('语音设置保存失败，请重试。');}
  showVoicePreferences();
}
for(const id of ['voiceEnabled','voiceSpeak','voiceSpeaker','voiceThreshold'])$('#'+id).onchange=saveVoicePreferences;
$('#voicePreview').onclick=async()=>{if(await window.agendaPet.previewVoice())$('#voiceStatus').textContent=t('正在朗读…');};
let savedAccessEnabled=false;
async function accessAction(action,value){
  const controls=['desktopAccess','accessAddApp','accessAddCode','accessOutput'].map(id=>$('#'+id));
  controls.forEach(el=>el.disabled=true);
  try{
    const result=await window.agendaPet.access(action,value);if(result.error)throw Error(result.error);
    savedAccessEnabled=result.enabled;$('#desktopAccess').checked=result.enabled;
    $('#accessItems').replaceChildren();
    for(const kind of ['apps','files'])for(const item of result[kind]){
      const row=node('div','access-item'),label=node('span','',t(kind==='apps'?'软件':'代码')+' · '+(item.name||item.path));label.title=item.path;
      const remove=button('',t('移除'),()=>accessAction('remove',{kind,id:item.id}));row.append(label,remove);$('#accessItems').append(row);
    }
    $('#accessStatus').textContent=t(result.enabled?'开放权限已开启，仅限已授权项目。':'开放权限已关闭。');
  }catch(error){$('#desktopAccess').checked=savedAccessEnabled;$('#accessStatus').textContent=error.message;}
  finally{controls.forEach(el=>el.disabled=!window.agendaPet?.access);}
}
$('#desktopAccess').onchange=()=>accessAction('enabled',$('#desktopAccess').checked);
$('#accessAddApp').onclick=()=>accessAction('add','apps');
$('#accessAddCode').onclick=()=>accessAction('add','files');
$('#accessOutput').onclick=()=>accessAction('output');
if(window.agendaPet?.access&&!window.agendaToday?.standalone)accessAction('state');
else for(const id of ['desktopAccess','accessAddApp','accessAddCode','accessOutput'])$('#'+id).disabled=true;
window.addEventListener('agenda-language',()=>{if(window.agendaPet?.access&&!window.agendaToday?.standalone)accessAction('state');});
window.addEventListener('agenda-voice-event',event=>{
  if(event.detail.type==='voice-error'){voicePreferences={...voicePreferences,enabled:false};showVoicePreferences();}
  if(['voice-status','voice-error'].includes(event.detail.type))$('#voiceStatus').textContent=t(event.detail.text);
});

let updateState;
function renderUpdates(value=updateState){
  if(!value){$('#autoUpdate').disabled=$('#checkUpdate').disabled=true;$('#updateStatus').textContent=t('自动更新仅在 Windows 安装版中可用。');return;}
  updateState=value;$('#autoUpdate').checked=value.enabled;
  $('#updateVersion').textContent=t`当前版本 ${value.version}`;
  const messages={idle:'尚未检查更新',checking:'正在检查更新…',current:'当前已是最新版本',downloading:'正在下载更新…',ready:'更新已下载，退出时安装；也可立即重启更新。',unavailable:'更新源尚未提供自动更新文件，请稍后重试。',error:'更新失败，请检查网络后重试。'};
  $('#updateStatus').textContent=t(messages[value.status]||messages.error)+(value.available?' · '+value.available:'');
  if(value.status==='ready'&&!value.enabled)$('#updateStatus').textContent=t('更新已下载，点击立即重启更新以安装。');
  $('#checkUpdate').disabled=['checking','downloading','ready'].includes(value.status);
  $('#installUpdate').hidden=value.status!=='ready';$('#updateProgress').hidden=value.status!=='downloading';$('#updateProgress').value=value.progress;
}
window.addEventListener('agenda-update-state',event=>renderUpdates(event.detail));
window.addEventListener('agenda-language',()=>renderUpdates());
if(window.agendaUpdates)window.agendaUpdates.state().then(renderUpdates).catch(()=>renderUpdates());else renderUpdates();
$('#autoUpdate').onchange=async()=>{const input=$('#autoUpdate');input.disabled=true;try{if(!await window.agendaUpdates.configure(input.checked))throw Error(t('设置保存失败，请重试。'));}catch(error){input.checked=updateState.enabled;toast(error.message);}finally{input.disabled=false;}};
$('#checkUpdate').onclick=async()=>{try{$('#checkUpdate').disabled=true;renderUpdates(await window.agendaUpdates.check());}catch{renderUpdates({...updateState,status:'error'});}};
$('#installUpdate').onclick=async()=>{if(!await saveDiary())return;try{if(!await window.agendaUpdates.install())toast(t('更新尚未准备好，请稍后重试。'));}catch{toast(t('更新失败，请检查网络后重试。'));}};
