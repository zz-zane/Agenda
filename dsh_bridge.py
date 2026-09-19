"""Official DSH SDK process; private HTTP adapter reuses Agenda's provider client."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
VERSION = '0.1.5-rc.2'


def run(messages, request, tools, *, schemas=(), max_calls=6, max_tools=None, cancelled=lambda: False, timeout=120):
    max_tools = max_calls if max_tools is None else max_tools
    package = ROOT/'dsh/node_modules/@deepseek-ai/dsh/package.json'
    node = os.environ.get('AGENDA_NODE_BINARY') or shutil.which('node')
    if not package.exists() or not node:
        return {'status':'runtime_error','result':'请先运行 scripts/install-ai.bat 安装 DeepSeek Harness。'}
    metadata = json.loads(package.read_text(encoding='utf-8'))
    if metadata['version'] != VERSION:
        return {'status':'runtime_error','result':'Harness 版本不匹配，请运行 scripts/install-ai.bat。'}
    started = time.monotonic()
    token = uuid.uuid4().hex
    lock = threading.Lock()
    state = {'requests':0, 'tools':0, 'closed':False, 'failure':None}
    def stopped():
        return state['closed'] or cancelled() or time.monotonic()-started >= timeout
    definitions = [{'name':name, 'description':callback.__doc__ or name,
                    'parameters':{k:({'type':'array','items':{'type':'json'},'required':True} if t is list else {'type':'json' if t is dict else 'string','required':True}) for k,t in types.items()}}
                   for name,(types,callback) in tools.items()]
    for definition in definitions:
        source=next((s['function'] for s in schemas if s['function']['name']==definition['name']),None)
        if source: definition['description']=source['description']+' 参数约定：'+json.dumps(source['parameters'],ensure_ascii=False)

    class Bridge(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, body, status=200, mime='application/json'):
            raw = body if isinstance(body,bytes) else json.dumps(body,ensure_ascii=False).encode()
            try:
                self.send_response(status); self.send_header('Content-Type',mime)
                self.send_header('Content-Length',str(len(raw))); self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError,ConnectionResetError): pass
        def authorized(self):
            return self.headers.get('Authorization') == 'Bearer '+token and not stopped()
        def do_GET(self):
            if not self.authorized(): return self.reply({},403)
            return self.reply({'tools':definitions}) if self.path=='/bridge/config' else self.reply({},404)
        def do_POST(self):
            if not self.authorized(): return self.reply({},403)
            try:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 2*1024*1024: return self.reply({},413)
                self.connection.settimeout(5)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload,dict): raise ValueError()
                if self.path == '/bridge/tool':
                    with lock:
                        if stopped() or state['tools'] >= max_tools:
                            state['failure']='max_calls'; return self.reply({},429)
                        state['tools'] += 1
                        name,args = payload.get('name'),payload.get('args')
                        if name not in tools: return self.reply({'error':'tool_rejected'})
                        types,callback = tools[name]
                        if not isinstance(args,dict) or set(args)!=set(types) or any(type(args[k]) is not t for k,t in types.items()):
                            return self.reply({'error':'tool_rejected'})
                        return self.reply(callback(**args))
                if self.path != '/v1/chat/completions': return self.reply({},404)
                with lock:
                    if stopped() or state['requests'] >= max_calls:
                        state['failure']='max_calls'; return self.reply({},429)
                    state['requests'] += 1
                try:
                    if {t['function']['name'] for t in payload.get('tools',[])} != set(tools): raise ValueError()
                    answer = request(payload['messages'])
                    if not isinstance(answer,dict) or answer.get('role')!='assistant': raise ValueError()
                    delta = {k:v for k,v in answer.items() if k in ('role','content','reasoning_content','tool_calls')}
                    calls = delta.get('tool_calls')
                    if calls is not None:
                        if not isinstance(calls,list) or not calls or len(calls)>max_tools-state['tools']: raise ValueError()
                        ids=set()
                        def unique(pairs):
                            out={}
                            for k,v in pairs:
                                if k in out: raise ValueError()
                                out[k]=v
                            return out
                        def invalid_constant(value): raise ValueError()
                        for call in calls:
                            if not isinstance(call,dict) or call.get('type')!='function' or not isinstance(call.get('id'),str) or not call['id'] or call['id'] in ids: raise ValueError()
                            ids.add(call['id'])
                            f=call['function']
                            if not isinstance(f.get('name'),str) or not isinstance(f.get('arguments'),str): raise ValueError()
                            args=json.loads(f['arguments'],object_pairs_hook=unique,parse_constant=invalid_constant)
                            if not isinstance(args,dict): raise ValueError()
                        delta['tool_calls'] = [{**call,'index':i} for i,call in enumerate(calls)]
                    if stopped(): return self.reply({},408)
                except Exception:
                    state['failure']='model_error'; return self.reply({'error':{'message':'Agenda model request failed'}},400)
                common={'id':'agenda','object':'chat.completion.chunk','created':int(time.time()),'model':payload['model']}
                chunks=[{**common,'choices':[{'index':0,'delta':delta,'finish_reason':None}]},
                        {**common,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if calls else 'stop'}]}]
                raw=(''.join('data: '+json.dumps(c,ensure_ascii=False)+'\n\n' for c in chunks)+'data: [DONE]\n\n').encode()
                return self.reply(raw,mime='text/event-stream')
            except Exception:
                return self.reply({'error':'invalid_request'},400)

    server = ThreadingHTTPServer(('127.0.0.1',0),Bridge)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    process = None
    # ponytail: one fresh SDK session per chat; SQLite holds the short conversation history.
    with tempfile.TemporaryDirectory(prefix='agenda-dsh-') as directory:
        work = Path(directory)
        changes = [{'id':i,'disabled':True} for i in ('persistent-bash','persistent-pwsh','terminal-bash','terminal-pwsh','pty','subprocess','llm-retry','session-log-deepseek','plugin-package-inventory-deepseek')]
        changes.append({'insert':[{'id':'agenda-tools','name':(ROOT/'dsh/agenda-plugin.mjs').as_uri()}]})
        patch = work/'patch.json'; patch.write_text(json.dumps(changes),encoding='utf-8')
        system = messages[0]['content']
        prompt = '\n\n'.join(m['content'] for m in messages[1:-1] if m['role']=='system')
        history = [m for m in messages[:-1] if m['role']!='system']
        if history: prompt += '\n历史对话（仅供上下文）：'+json.dumps(history,ensure_ascii=False)
        prompt += '\n用户本轮消息：\n'+messages[-1]['content']
        base = f'http://127.0.0.1:{server.server_port}'
        env = {**os.environ,'DSH_HOME':str(work/'home'),'DSH_SYSTEM_PROMPT':system,
               'DEEPSEEK_API_KEY':token,'DEEPSEEK_BASE_URL':base+'/v1',
               'AGENDA_BRIDGE':base,'AGENDA_BRIDGE_TOKEN':token,'AGENDA_DSH_PACKAGE':str(ROOT/'dsh/package.json')}
        env.pop('AI_API_KEY',None)
        binary=metadata['bin']; binary=binary['dsh'] if isinstance(binary,dict) else binary
        incoming=queue.Queue()
        try:
            process=subprocess.Popen([node,str(package.parent/binary),'--profile','sdk-minimal','--patch',str(patch)],
                cwd=work,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            def read():
                for line in process.stdout: incoming.put(line)
                incoming.put(None)
            reader=threading.Thread(target=read,daemon=True);reader.start()
            def send(i,method,params):
                process.stdin.write(json.dumps({'jsonrpc':'2.0','id':i,'method':method,'params':params})+'\n');process.stdin.flush()
            send(1,'initialize',{'cwd':str(work),'provider':'deepseek-official','model':'deepseek-chat','maxTokens':8192})
            result=''; reason=None
            while not stopped():
                try: line=incoming.get(timeout=min(.25,max(.01,timeout-(time.monotonic()-started))))
                except queue.Empty: continue
                if line is None: break
                value=json.loads(line)
                if value.get('error'): break
                if value.get('id')==1:
                    send(2,'session/prompt',{'sessionId':'agenda','contentBlocks':[{'type':'text','text':prompt}]})
                event=value.get('params',{}).get('event',{})
                if event.get('type')=='assistant/message':
                    text=''.join(b.get('text','') for b in event['data']['message']['content'] if b['type']=='text')
                    if text: result=text
                if event.get('type')=='turn/end': reason=event['data']['reason']['kind']
                if reason and value.get('method')=='session.status' and value['params'].get('status')=='idle':
                    return {'status':state['failure'] or ('completed' if reason=='completed' else 'runtime_error'), 'result':result if reason=='completed' else None}
            return {'status':state['failure'] or ('cancelled' if stopped() else 'runtime_error')}
        except (OSError,ValueError):
            return {'status':'runtime_error','result':'DeepSeek Harness 启动或通信失败，请检查 Node 与安装依赖。'}
        finally:
            with lock: state['closed']=True
            if process:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait(5)
                process.stdin.close(); reader.join(2); process.stdout.close()
            server.shutdown(); server.server_close()
