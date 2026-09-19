const {readFileSync,writeFileSync,renameSync,mkdirSync} = require('node:fs');
const path = require('node:path');

module.exports = function createUpdates(engine, {directory,version,publish,close}) {
  const file=path.join(directory,'updates.json');
  let enabled=true,active=false,manualInstall=false;
  try{enabled=JSON.parse(readFileSync(file,'utf8')).enabled!==false;}catch{}
  let state={version,enabled,status:'idle',progress:0,available:null};
  const update=value=>{state={...state,...value};publish({...state});};
  engine.logger=null;engine.allowPrerelease=false;engine.allowDowngrade=false;
  engine.autoDownload=true;engine.autoInstallOnAppQuit=enabled;
  engine.on('checking-for-update',()=>update({status:'checking',progress:0}));
  engine.on('update-available',info=>update({status:'downloading',available:info.version}));
  engine.on('download-progress',info=>update({status:'downloading',progress:Math.max(0,Math.min(100,Math.round(info.percent)))}));
  engine.on('update-not-available',()=>update({status:'current',available:null}));
  engine.on('update-downloaded',info=>update({status:'ready',progress:100,available:info.version}));
  engine.on('error',error=>update({status:/LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|404/.test(error.code+' '+error.message)?'unavailable':'error'}));
  return {
    get:()=>({...state}),
    async check(){
      if(active||state.status==='ready')return {...state};
      active=true;
      try{const result=await engine.checkForUpdates();if(result?.downloadPromise)await result.downloadPromise;}
      catch{if(!['error','unavailable'].includes(state.status))update({status:'error'});}
      finally{active=false;}
      return {...state};
    },
    configure(value){
      if(typeof value!=='boolean')return false;
      try{mkdirSync(directory,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({enabled:value}));renameSync(file+'.tmp',file);}
      catch{return false;}
      enabled=value;engine.autoInstallOnAppQuit=value;if(value&&state.status==='ready')engine.addQuitHandler();update({enabled});return true;
    },
    install(){if(state.status!=='ready'||manualInstall)return false;manualInstall=true;close();return true;},
    finishQuit(){if(!manualInstall||state.status!=='ready')return false;engine.quitAndInstall(true,true);return true;},
  };
};
