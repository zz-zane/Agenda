const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');

module.exports = function createPet(executable, {openAI, openToday, disabled, failed, voiceEvent}) {
  let child, ready = false, state = 'idle';
  let voice = {enabled:false, speak:true, speaker:21, threshold:300};
  let theme = 'light';
  const pendingReminders = new Map();
  function send(value) { if (child && ready && !child.stdin.destroyed) child.stdin.write(JSON.stringify(value)+'\n'); }
  return {
    async start() {
      if (child) return;
      const env = {...process.env};
      for (const key of ['AI_API_KEY', 'DEEPSEEK_API_KEY', 'AGENDA_DESKTOP_TOKEN', 'AGENDA_ACCESS_TOKEN', 'AGENDA_ACCESS_PORT', 'NODE_OPTIONS']) delete env[key];
      const current = child = spawn(executable, ['--pet'], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env});
      current.stdin.on('error', () => {});
      const lines = createInterface({input: current.stdout});
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { current.kill(); reject(Error('pet startup timeout')); }, 15000);
        const fail = () => { clearTimeout(timer); reject(Error('pet unavailable')); };
        current.once('error', fail);
        current.once('exit', () => {
          fail();
          if (child === current) { child = null; if (ready) failed(); ready = false; }
        });
        lines.on('line', line => {
          if (child !== current) return;
          if (line === 'ready') { clearTimeout(timer); ready = true; current.stdin.write(state+'\n'); send({type:'theme',value:theme}); send({type:'voice-config',...voice}); resolve(); }
          else if (line === 'open-ai' && ready) openAI();
          else if (line === 'open-today' && ready) openToday();
          else if (line === 'disable' && ready) disabled();
          else if (line.startsWith('{') && line.length <= 100000 && ready) {
            try { const event=JSON.parse(line);
              if(event.type==='reminder-shown')pendingReminders.get(event.id)?.();
              if (['voice-status','voice-text','voice-error'].includes(event.type) && typeof event.text==='string' && event.text.length<=12000) voiceEvent(event);
            } catch {}
          }
        });
      });
    },
    async stop() {
      const current = child; child = null; ready = false;
      if (!current || !current.pid || current.exitCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => { current.kill(); }, 3000);
        current.once('exit', () => { clearTimeout(timer); resolve(); });
        current.stdin.end();
      });
    },
    state(value) {
      if (!['working', 'done', 'idle'].includes(value)) return;
      state = value;
      if (child && ready && !child.stdin.destroyed) child.stdin.write(value+'\n');
    },
    configure(value) { voice = value; send({type:'voice-config',...voice}); },
    theme(value) { if(['light','dark'].includes(value)){theme=value;send({type:'theme',value});} },
    reply(text, ok, bubble=false) { send({type:'reply',text:text.length>12000?text.slice(0,12000)+'\n…完整回复见 AI 聊天记录。':text,ok,bubble}); },
    remind(id,text) {
      if(!child || !ready)return Promise.resolve(false);
      return new Promise(resolve=>{
        const finish=ok=>{clearTimeout(timer);pendingReminders.delete(id);resolve(ok);};
        const timer=setTimeout(()=>finish(false),5000);
        pendingReminders.set(id,()=>finish(true));send({type:'reminder',id,text});
      });
    },
    preview() { send({type:'voice-preview'}); },
  };
};
