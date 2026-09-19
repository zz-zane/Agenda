const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');
const path=require('node:path');
const create=require('../desktop/updates.cjs');
mkdirSync('.preview',{recursive:true});const directory=mkdtempSync(path.resolve('.preview/update-test-'));
(async()=>{
 const engine=new EventEmitter();let releaseCheck,checks=0,closed=0,installed=0,quitHooks=0;
 engine.checkForUpdates=()=>{checks++;engine.emit('checking-for-update');return new Promise(resolve=>releaseCheck=resolve);};
 engine.addQuitHandler=()=>quitHooks++;
 engine.quitAndInstall=(silent,reopen)=>{assert(silent&&reopen);installed++;};
 let latest;const options={directory,version:'3.1.1',publish:v=>latest=v,close:()=>closed++};
 try{
 const updater=create(engine,options);assert.equal(engine.allowDowngrade,false);assert.equal(engine.allowPrerelease,false);
 assert.equal(updater.install(),false);
 const first=updater.check();await updater.check();assert.equal(checks,1);
 engine.emit('update-available',{version:'3.2.0'});engine.emit('download-progress',{percent:41.4});assert.equal(latest.progress,41);
 let finish;releaseCheck({downloadPromise:new Promise(r=>finish=r)});await Promise.resolve();
 engine.emit('error',Error('checksum mismatch'));finish();await first;assert.equal(updater.get().status,'error');assert.equal(updater.install(),false);
 const retry=updater.check();engine.emit('update-downloaded',{version:'3.2.0'});releaseCheck({});await retry;
 assert.equal(updater.get().status,'ready');assert.equal(updater.configure(false),true);assert.equal(engine.autoInstallOnAppQuit,false);
 assert.equal(create(new EventEmitter(),options).get().enabled,false);
 assert.equal(updater.configure('true'),false);assert.equal(updater.get().enabled,false);
 assert.equal(updater.configure(true),true);assert.equal(quitHooks,1);assert.equal(updater.configure(false),true);
 assert.equal(updater.install(),true);assert.equal(updater.install(),false);assert.equal(closed,1);assert.equal(installed,0);
 updater.finishQuit();assert.equal(installed,1);
 console.log('Updates: concurrent checks, progress, checksum-error recovery, persisted opt-out, ready-only installation and shutdown ordering passed.');
 }finally{assert.equal(path.dirname(directory),path.resolve('.preview'));rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
