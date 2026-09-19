import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createAccess from '../desktop/access.cjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'agenda-access-check-'));
const launches=[],access=await createAccess(home,async file=>launches.push(file));
const post=async(name,args={},token=access.token)=>{
  const response=await fetch(`http://127.0.0.1:${access.port}/tool`,{method:'POST',headers:{'X-Agenda-Access':token},body:JSON.stringify({name,args})});
  return {status:response.status,...await response.json()};
};
try {
  const source=path.join(home,'example.py'),app=path.join(home,'viewer.exe');
  await fs.writeFile(source,'print("original")\n');await fs.writeFile(app,'not an actual executable');
  await access.add('files',source);await access.add('apps',app);
  const fileId=access.status().files[0].id,appId=access.status().apps[0].id;
  assert.equal((await post('desktop_status',{},'wrong')).status,403);
  assert((await post('desktop_read_code',{id:fileId})).error);
  await access.setEnabled(true);
  assert.equal((await post('desktop_read_code',{id:fileId})).content,'print("original")\n');
  assert((await post('desktop_read_code',{id:source})).error);
  assert((await post('desktop_open_app',{id:appId,args:['--run']})).error);
  assert((await post('delete_file',{id:fileId})).error);
  const copy=await post('desktop_save_copy',{id:fileId,content:'print("corrected")\n'});
  assert(copy.original_unchanged);assert.equal(copy.executed,false);
  assert.equal(await fs.readFile(source,'utf8'),'print("original")\n');
  assert.equal(await fs.readFile(path.join(access.status().output,copy.created),'utf8'),'print("corrected")\n');
  // Actual Python -> official DSH -> authenticated Electron bridge with a simulated model.
  const python=spawn('py',['-3.13','-c',`
import json, tempfile
from pathlib import Path
import local_server as app
import local_ai
import desktop_tools
import os
assert 'AGENDA_ACCESS_TOKEN' not in os.environ
calls=[]
def provider(messages,schemas):
    calls.append(1)
    assert any(s['function']['name']=='desktop_read_code' for s in schemas)
    if len(calls)==1: name='desktop_read_code';args={'id':'${fileId}'}
    elif len(calls)==2:
        assert 'original' in messages[-1]['content']
        name='desktop_save_copy';args={'id':'${fileId}','content':'print("reviewed")\\n','user_quote':'修复代码并另存副本'}
    else:
        assert json.loads(messages[-1]['content'])['original_unchanged']
        return {'role':'assistant','content':'副本已保存；原文件未改动。'}
    return {'role':'assistant','content':None,'tool_calls':[{'id':str(len(calls)),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}
with tempfile.TemporaryDirectory() as directory:
    app.DATA=Path(directory);app.initialize()
    result=local_ai.chat(app,{'message':'修复代码并另存副本'},request_fn=provider)
    assert result['status']=='completed',result
    assert len(calls)==3,calls
print('PASS: simulated model through official DSH and real desktop bridge creates copy')
`],{env:{...process.env,AGENDA_ACCESS_PORT:String(access.port),AGENDA_ACCESS_TOKEN:access.token},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';python.stdout.on('data',chunk=>log+=chunk);python.stderr.on('data',chunk=>log+=chunk);
  const [exit]=await once(python,'exit');assert.equal(exit,0,log);console.log(log.trim());
  assert.equal(await fs.readFile(source,'utf8'),'print("original")\n');
  const copy2=await post('desktop_save_copy',{id:fileId,content:'another copy'});assert.notEqual(copy.created,copy2.created);
  await post('desktop_open_app',{id:appId});assert.deepEqual(launches,[app]);
  await access.add('apps','shell:AppsFolder\\Example.Desktop!App','Registered example');
  const registered=access.status().apps.find(v=>v.name==='Registered example');
  assert.equal((await post('desktop_open_app',{id:registered.id})).opened,'Registered example');
  assert.equal(launches.pop(),'shell:AppsFolder\\Example.Desktop!App');
  await assert.rejects(access.add('apps','shell:AppsFolder\\Example.Desktop!App & calc.exe'));
  const shell=path.join(home,'powershell.exe');await fs.writeFile(shell,'');await assert.rejects(access.add('apps',shell));
  await fs.writeFile(path.join(home,'.env'),'secret');await assert.rejects(access.add('files',path.join(home,'.env')));
  await access.remove('files',fileId);assert((await post('desktop_read_code',{id:fileId})).error);
  await access.add('files',source);
  const output=access.status().output,outside=path.join(home,'outside');await fs.mkdir(outside);
  await fs.rename(output,output+'-previous');await fs.symlink(outside,output,process.platform==='win32'?'junction':'dir');
  assert((await post('desktop_save_copy',{id:access.status().files[0].id,content:'blocked'})).error);
  assert.deepEqual(await fs.readdir(outside),[]);
  await access.setEnabled(false);
  assert((await post('desktop_open_app',{id:appId})).error);assert.equal(launches.length,1);
  assert.equal((await post('desktop_status')).apps,undefined);
  console.log('PASS: private bridge, default off, allowlist read/open, no command arguments, exclusive copies, original untouched, junction rejected, revoke/disable enforced. App launch uses a stub.');
}finally{await access.close();await fs.rm(home,{recursive:true,force:true});}
