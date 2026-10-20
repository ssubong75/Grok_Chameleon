export class PathBooleanTask{
  constructor(){this.worker=null;this.reject=null;}
  run(paths,operation,tolerance){
    this.cancel();return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./path-boolean-worker.js',import.meta.url),{type:'module'});this.worker=worker;this.reject=reject;
      const finish=(error,path)=>{if(this.worker!==worker)return;this.worker=null;this.reject=null;worker.terminate();if(error)reject(error);else resolve(path);};
      worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data.path);
      worker.onerror=event=>{event.preventDefault();finish(new Error(event.message||'Path operation failed.'));};
      worker.onmessageerror=()=>finish(new Error('Path operation returned unreadable data.'));
      try{worker.postMessage({paths,operation,tolerance});}catch(error){finish(error);}
    });
  }
  cancel(){const worker=this.worker,reject=this.reject;this.worker=null;this.reject=null;if(worker)worker.terminate();if(reject){const error=new Error('Path operation cancelled.');error.name='AbortError';reject(error);}}
}
