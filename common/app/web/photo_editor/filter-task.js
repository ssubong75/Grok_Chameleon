export class FilterTask{
  cancel(){if(this.worker){this.worker.terminate();this.worker=null;const reject=this.reject;this.reject=null;reject?.(new DOMException('Filter cancelled','AbortError'));}}
  run(canvas,name,amount){
    this.cancel();const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),worker=new Worker(new URL('./filter-worker.js',import.meta.url),{type:'module'});this.worker=worker;
    return new Promise((resolve,reject)=>{this.reject=reject;const done=()=>{worker.terminate();if(this.worker===worker){this.worker=null;this.reject=null;}};
      worker.onmessage=event=>{done();if(event.data.error)reject(Error(event.data.error));else{const image=new ImageData(new Uint8ClampedArray(event.data.buffer),event.data.width,event.data.height);image.x=event.data.x||0;image.y=event.data.y||0;resolve(image);}};worker.onerror=event=>{done();reject(Error(event.message||'Filter worker failed.'));};
      worker.postMessage({width:image.width,height:image.height,buffer:image.data.buffer,name,amount},[image.data.buffer]);
    });
  }
}
