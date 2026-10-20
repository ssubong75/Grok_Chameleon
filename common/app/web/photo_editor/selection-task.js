export class SelectionTask{
  cancel(){this.worker?.terminate();this.worker=null;const reject=this.reject;this.reject=null;reject?.(new DOMException('Selection operation cancelled','AbortError'));}
  run(canvas,mask,operation,settings){
    this.cancel();const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    return this.dispatch(image.width,image.height,image.data.buffer,mask,operation,settings);
  }
  runMask(mask,width,height,operation,settings){this.cancel();return this.dispatch(width,height,null,mask,operation,settings);}
  dispatch(width,height,buffer,mask,operation,settings){
    const coverage=new Uint8ClampedArray(mask),worker=new Worker(new URL('./selection-worker.js',import.meta.url),{type:'module'});
    this.worker=worker;
    return new Promise((resolve,reject)=>{
      this.reject=reject;
      const done=()=>{worker.terminate();if(this.worker===worker){this.worker=null;this.reject=null;}};
      worker.onmessage=event=>{if(this.worker!==worker)return;done();try{if(event.data.error)throw Error(event.data.error);resolve({mask:new Uint8ClampedArray(event.data.mask),image:event.data.image?new ImageData(new Uint8ClampedArray(event.data.image),event.data.width,event.data.height):null});}catch(error){reject(error);}};
      worker.onerror=event=>{event.preventDefault();done();reject(Error(event.message||'Selection worker failed.'));};
      worker.onmessageerror=()=>{done();reject(Error('Selection worker returned unreadable data.'));};
      try{
        const workerSettings={...settings},brush=settings?.brushMap?new Int16Array(settings.brushMap):null;delete workerSettings.brushMap;
        const transfer=[coverage.buffer];if(buffer)transfer.push(buffer);if(brush)transfer.push(brush.buffer);
        worker.postMessage({width,height,buffer,mask:coverage.buffer,operation,settings:workerSettings,brush:brush?.buffer},transfer);
      }catch(error){done();reject(error);}
    });
  }
}
