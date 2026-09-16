import {t} from './i18n.js';
const $=s=>document.querySelector(s);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const stars=el('div',undefined,'composer-stars');
stars.setAttribute('aria-hidden','true');
for(let i=0;i<16;i++){
  const star=el('span');
  const place=()=>{star.style.left=`${3+Math.random()*94}%`;star.style.top=`${5+Math.random()*90}%`;};
  place();
  star.style.animationDuration=`${3+Math.random()*3}s`;
  star.style.animationDelay=`${-Math.random()*6}s`;
  star.addEventListener('animationiteration',place);
  stars.append(star);
}
$('#chatForm').prepend(stars);
let data={config:{configured:false},messages:[],proposals:[],goals:[],imports:[],tasks:[],attachments:[]},attachment=null,busy=false;
async function call(path,body){const r=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error||t('请求失败'));return value;}
function error(e){$('#aiError').textContent=e.message||String(e);}
function messageText(text){
  const content=el('div',undefined,'message-text');
  for(const line of text.split('\n')){
    const row=el('div');
    const value=line.replace(/^\s*[-*] /,'• ');
    for(const part of value.split(/(\*\*[^*]+\*\*)/g))row.append(part.startsWith('**')&&part.endsWith('**')?el('strong',part.slice(2,-2)):document.createTextNode(part));
    if(!value)row.append(el('br'));content.append(row);
  }
  return content;
}
function render(){
  $('#generateProfile').disabled=busy;
  if(!busy)$('#generateProfile').textContent=data.profile?.generated?t('重新生成学习画像'):t('生成学习画像');
  const profile=$('#profileContent');profile.replaceChildren();
  if(data.profile){
    const p=data.profile,r=p.records;
    profile.append(el('p',t`照片 ${r.photos} · 聊天 ${r.chat} 条 · 课表批次 ${r.imports} · 原文件 ${r.source_files} · 打卡 ${r.checkins} 天`));
    if(!p.facts.length)profile.append(el('p',t('还没有明确的学习偏好。聊天中告诉我你的习惯或时间限制，我会记录原话。'),'muted'));
    for(const fact of p.facts)profile.append(el('p',`${fact.name}：${fact.quote}`));
    if(p.generated){
      const g=p.generated;profile.append(el('h3',t('已生成的学习画像')),el('p',`${g.model} · ${g.created_at} UTC`,'muted'),messageText(g.body.summary));
      for(const pref of g.body.preferences)profile.append(el('p',pref));
      showEstimates(profile,g.body.difficulty_estimates);
      for(const tip of g.body.adjustments)profile.append(el('p',t('建议：')+tip));
    }
    profile.append(el('p',t('可以在聊天中更正已有偏好。照片用于记录，图片内容尚未自动识别。'),'muted'));
  }else profile.append(el('p',t('请重启本地服务以启用画像数据库。'),'muted'));
  $('#aiStatus').textContent=data.config.configured?data.config.model:t('选择模型');
  $('#aiStatus').title=data.config.runtime||'DeepSeek Harness';
  const log=$('#chatMessages');log.replaceChildren();
  if(!data.messages.length){const empty=el('div',undefined,'chat-welcome');empty.append(el('span','✧','chat-star'),el('h2',t('今天想安排什么？')),el('p',t('可以说“这两天有事，帮我重排学习任务”，也可以附上课表让我导入。'),'muted'));log.append(empty);}
  for(const m of data.messages){const bubble=el('article',undefined,'chat-bubble '+m.role);bubble.append(el('small',m.role==='user'?t('你'):'Agenda'),messageText(m.content));log.append(bubble);}
  log.scrollTop=log.scrollHeight;
  const area=$('#aiProposals');area.replaceChildren();
  for(const p of data.proposals.filter(p=>p.status==='pending').slice(-6)){
    const b=p.body,card=el('article',undefined,'proposal');
    const title=p.kind==='plan'?`${b.title} · ${b.mode}`:p.kind==='import'?t('导入课表'):p.kind==='delete_import'?t('撤销课表导入'):p.kind==='delete_courses'?t('删除指定课程'):t('调整日程');
    card.append(el('h3',title),el('p',b.reason||t('请核对以下变更。')));
    if(p.kind==='plan'){
      if(b.assessment){card.append(el('p',t`依据学习画像 #${b.assessment.profile_id} · 本计划完成估计`));showEstimates(card,b.assessment.estimates);for(const tip of b.assessment.adjustments)card.append(el('p',t('定制调整：')+tip));}
      const old=data.goals.find(g=>g.id===b.goal_id);
      card.append(el('p',t`截止：${b.deadline}${old&&old.deadline!==b.deadline?t`（由 ${old.deadline} 延长）`:''} · ${b.sessions.length} 项安排`,'proposal-summary'));
      const outline=el('ul');for(const topic of b.topics)outline.append(el('li',t`${topic.title} · ${topic.minutes} 分钟（完整大纲工作量）`));card.append(outline);
    }
    if(p.kind==='import'){const a=data.attachments.find(a=>a.id===b.attachment_id);card.append(el('p',a?t`${a.name} · ${a.count} 项（重复安排自动跳过）`:t('附件 ')+b.attachment_id));}
    if(p.kind==='delete_import'){
      const batch=data.imports.find(i=>i.id===b.batch_id),tasks=data.tasks.filter(t=>t.batch_id===b.batch_id);
      card.append(el('p',t`${batch?.name||b.batch_id} · 删除 ${tasks.length} 项课程安排，包含历史日期。照片和打卡保留。`,'error'));
      addSessions(card,tasks);
    }
    if((p.kind==='tasks'||p.kind==='delete_courses')&&b.delete_ids.length){card.append(el('strong',t`将删除以下 ${b.delete_ids.length} 项安排：`));addSessions(card,data.tasks.filter(t=>b.delete_ids.includes(t.id)));}
    if(p.kind==='edit_courses'){card.append(el('strong',t('原课程：')));addSessions(card,data.tasks.filter(t=>b.courses.some(c=>c.id===t.id)));card.append(el('strong',t('修改为：')));addSessions(card,b.courses);}
    if(b.sessions||b.tasks)addSessions(card,b.sessions||b.tasks);
    const confirm=el('button',t('确认执行'),'primary');confirm.type='button';confirm.disabled=busy;
    confirm.onclick=async()=>{confirm.disabled=true;$('#aiError').textContent='';try{await call('/api/ai/apply',{id:p.id});await load();window.dispatchEvent(new Event('agenda-refresh'));}catch(e){error(e);confirm.disabled=false;}};
    card.append(confirm);area.append(card);
  }
}
function addSessions(card,sessions){const detail=el('details');detail.append(el('summary',t`查看 ${sessions.length} 项具体安排`));const list=el('ul',undefined,'session-list');for(const s of sessions)list.append(el('li',`${s.date} ${s.start}–${s.end} · ${s.title}${s.note?' — '+s.note:''}`));detail.append(list);card.append(detail);}
async function load(){data=await call('/api/ai/state');render();renderModels();}
function showEstimates(parent,estimates){
  parent.append(el('p',t('以下为模型估计，未经统计校准，不保证完成。'),'muted'));
  for(const e of estimates)parent.append(el('p',`${e.difficulty}：${e.low===null?t('数据不足，暂不量化'):`${e.low}%–${e.high}%`} · ${e.basis}`));
}
$('#generateProfile').onclick=async()=>{
  if(busy)return;busy=true;$('#chatSend').disabled=true;$('#generateProfile').textContent=t('正在生成…');$('#aiError').textContent='';render();
  try{await call('/api/profile/generate',{});await load();}catch(e){error(e);}finally{busy=false;$('#chatSend').disabled=false;$('#generateProfile').textContent=t('重新生成学习画像');render();}
};
window.addEventListener('agenda-ai-open',()=>load().catch(error));
$('#aiStatus').onclick=()=>{document.querySelector('[data-page=settings]').click();$('#modelSettings').open=true;};
let editingModel=null,addingModel=false,configBusy=false;
const providers={deepseek:['https://api.deepseek.com','deepseek-chat'],openai:['https://api.openai.com/v1',''],claude:['https://api.anthropic.com/v1',''],custom:['','']};
function providerHint(){
  $('#providerHint').textContent=$('#modelProvider').value==='claude'?t('使用 Claude 官方 OpenAI 兼容接口，仅支持其兼容功能；填写你账户可用的模型 ID。'):t('需要支持 Chat Completions 和工具调用的模型；填写服务商提供的模型 ID 与 API Key。');
}
function editModel(item=null,adding=true){
  if(configBusy)return;
  const form=$('#aiConfigForm');editingModel=item?.id??null;addingModel=adding;
  form.hidden=false;form.dataset.initialized='true';
  form.elements.base_url.value=item?.base_url||providers.deepseek[0];form.elements.model.value=item?.model||'deepseek-chat';
  form.elements.api_key.value='';form.elements.api_key.required=adding;
  form.elements.api_key.placeholder=adding?t('输入该服务商的 API Key'):t('留空保留此模型已保存的密钥');
  $('#modelFormTitle').textContent=adding?t('添加新模型'):t('修改模型配置');
  $('#modelProvider').value=Object.keys(providers).find(k=>providers[k][0]===form.elements.base_url.value)||'custom';providerHint();
}
function renderModels(){
  const list=$('#configuredModels');list.replaceChildren();
  for(const model of data.models||[]){
    const card=el('article',undefined,'configured-model'),info=el('div');
    info.append(el('strong',model.model),el('small',`${model.active?t('当前使用 · '):''}${model.configured?t('已配置'):t('未填写密钥')} · ${model.base_url}`));
    const actions=el('div',undefined,'model-actions'),edit=el('button',t('修改'));edit.type='button';edit.disabled=configBusy;edit.onclick=()=>editModel(model,false);actions.append(edit);
    if(!model.active){const use=el('button',t('使用此模型'));use.type='button';use.disabled=configBusy;use.onclick=async()=>{
      if(configBusy)return;configBusy=true;renderModels();const status=$('#modelConfigStatus');status.className='muted';
      try{await call('/api/ai/config/select',{id:model.id});$('#aiConfigForm').hidden=true;await load();status.textContent=t('已切换当前模型');}
      catch(e){status.className='error';status.textContent=e.message||t('切换失败');}finally{configBusy=false;renderModels();}
    };actions.append(use);}
    card.append(info,actions);list.append(card);
  }
  $('#addModel').disabled=configBusy;
  if(!data.models?.length&&!$('#aiConfigForm').dataset.initialized)editModel(data.config,false);
}
$('#addModel').onclick=()=>editModel();
$('#cancelModel').onclick=()=>{if(!configBusy){$('#aiConfigForm').hidden=true;$('#aiConfigForm').elements.api_key.value='';}};
$('#modelProvider').onchange=()=>{const form=$('#aiConfigForm'),preset=providers[$('#modelProvider').value];form.elements.base_url.value=preset[0];form.elements.model.value=preset[1];form.elements.api_key.value='';providerHint();};
$('#aiConfigForm').onsubmit=async e=>{
  e.preventDefault();if(configBusy)return;configBusy=true;renderModels();
  const form=e.target,button=form.querySelector('button.primary'),status=$('#modelConfigStatus');button.disabled=true;status.className='muted';status.textContent=t('正在保存…');
  const body=Object.fromEntries(new FormData(form));if(addingModel)body.new=true;else if(editingModel!==null)body.id=editingModel;
  try{await call('/api/ai/config',body);form.elements.api_key.value='';form.hidden=true;await load();status.textContent=t('模型设置已保存');}
  catch(e){status.className='error';status.textContent=e.message||t('保存失败，请重试');}
  finally{configBusy=false;button.disabled=false;renderModels();}
};
$('#chatFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('#aiError').textContent='';$('#chatSend').disabled=true;try{if(!/\.xlsx$/i.test(file.name)||file.size>12*1024*1024)throw Error(t('请选择 12MB 以内的 .xlsx 文件'));const r=await fetch('/api/ai/attachment',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:file});const a=await r.json();if(!r.ok)throw Error(a.error);attachment=a;$('#chatAttachment').textContent=t`${a.name} · ${a.count} 项，尚未导入`;$('#clearAttachment').hidden=false;}catch(e){error(e);}finally{$('#chatSend').disabled=busy;}};
$('#clearAttachment').onclick=()=>{attachment=null;$('#chatAttachment').textContent='';$('#chatFile').value='';$('#clearAttachment').hidden=true;};
$('#chatForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;$('#aiError').textContent='';
  const message=$('#chatInput').value.trim();
  if(!message)return;
  busy=true;$('#chatSend').disabled=true;$('#chatSend').textContent=t('正在思考…');render();
  try{await call('/api/ai/chat',{message,attachment_id:attachment?.id||''});$('#chatInput').value='';await load();}
  catch(e){error(e);}finally{busy=false;$('#chatSend').disabled=false;$('#chatSend').textContent=t('发送 ↑');render();}
};
load().catch(error);

window.addEventListener('agenda-language', () => {
  render(); renderModels(); providerHint();
  $('#modelFormTitle').textContent = t(addingModel ? '添加新模型' : '修改模型配置');
  $('#aiConfigForm').elements.api_key.placeholder = t(addingModel ? '输入该服务商的 API Key' : '留空保留此模型已保存的密钥');
});
