// Real electron-updater + local HTTP metadata/download; never execute the fixture.
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {createHash}=require('node:crypto');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const path=require('node:path');
const {NsisUpdater}=require('../desktop/node_modules/electron-updater');
const {NodeHttpExecutor}=require('../desktop/node_modules/builder-util/out/nodeHttpExecutor');
const create=require('../desktop/updates.cjs');
mkdirSync('.preview',{recursive:true});const root=mkdtempSync(path.resolve('.preview/update-download-'));
const bytes=Buffer.from('Agenda isolated updater fixture - not an executable');
let remoteVersion='3.2.0',badHash=false,downloads=0;
const server=createServer((req,res)=>{
 if(req.url.startsWith('/latest.yml')){res.end(JSON.stringify({version:remoteVersion,files:[{url:'Agenda-Setup-'+remoteVersion+'-x64.exe',size:bytes.length,sha512:createHash('sha512').update(badHash?'wrong':bytes).digest('base64')}],releaseDate:new Date().toISOString()}));}
 else{downloads++;res.setHeader('Content-Length',bytes.length);res.end(bytes);}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 function make(name){
  const dir=path.join(root,name);mkdirSync(dir);const config=path.join(dir,'app-update.yml');writeFileSync(config,'updaterCacheDirName: '+name+'\n');
  const app={version:'3.1.1',name:'Agenda',isPackaged:true,userDataPath:dir,baseCachePath:dir,appUpdateConfigPath:config,whenReady:()=>Promise.resolve(),onQuit:()=>{}};
  const engine=new NsisUpdater(null,app);engine.httpExecutor=new NodeHttpExecutor();engine.httpExecutor.download=require('../desktop/node_modules/electron-updater/out/electronHttpExecutor').ElectronHttpExecutor.prototype.download;engine.setFeedURL({provider:'generic',url:'http://127.0.0.1:'+server.address().port});engine.disableDifferentialDownload=true;
  const updates=create(engine,{directory:dir,version:app.version,publish:()=>{},close:()=>{throw Error('Must not install fixture');}});
  return {engine,updates};
 }
 try{
  let {engine,updates}=make('valid');await updates.check();assert.equal(updates.get().status,'ready');assert.deepEqual(readFileSync(engine.installerPath),bytes);
  badHash=true;({engine,updates}=make('corrupt'));await updates.check();assert.equal(updates.get().status,'error');assert.equal(updates.install(),false);
  badHash=false;remoteVersion='2.1.0';const before=downloads;({updates}=make('older'));await updates.check();assert.equal(updates.get().status,'current');assert.equal(downloads,before);
  console.log('Real updater: metadata parsing, full download and SHA-512, corrupt payload rejection, no downgrade passed. No installer executed.');
 }finally{await new Promise(r=>server.close(r));assert.equal(path.dirname(root),path.resolve('.preview'));rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
