// External plugin: no changes to upstream DeepSeek Harness packages.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.env.AGENDA_DSH_PACKAGE);
const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
export const name='agenda-calendar';
export const inject=['tools'];
export async function apply(ctx){
  const base=process.env.AGENDA_BRIDGE;
  const headers={'Content-Type':'application/json','Authorization':'Bearer '+process.env.AGENDA_BRIDGE_TOKEN};
  const response=await fetch(base+'/bridge/config',{headers,signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Agenda bridge unavailable');
  const {tools}=await response.json();
  for(const tool of tools){
    ctx.tools.register(defineTool({
      name:tool.name,description:tool.description,parameters:tool.parameters,
      output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      async execute(args,exec){
        const r=await fetch(base+'/bridge/tool',{method:'POST',headers,body:JSON.stringify({name:tool.name,args}),signal:AbortSignal.any([exec.signal,AbortSignal.timeout(10000)])});
        if(!r.ok)throw Error('Agenda tool rejected');
        return r.json();
      },
    }));
  }
}
