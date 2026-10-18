import {paintRasterStroke} from './brush-engine.js';
import {surface} from './engine.js';
export class HealingTask{
  cancel(){this.worker?.terminate();this.worker=null;const reject=this.reject;this.reject=null;reject?.(new DOMException('Healing cancelled','AbortError'));}
  run(layer,source,points,offset,options){
    const margin=options.width/2+3;let left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))-layer.x-margin)),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))-layer.y-margin)),right=Math.min(layer.canvas.width,Math.ceil(Math.max(...points.map(p=>p.x))-layer.x+margin)),bottom=Math.min(layer.canvas.height,Math.ceil(Math.max(...points.map(p=>p.y))-layer.y+margin));
    if(options.spot&&right>left&&bottom>top){const side=Math.round(4*Math.sqrt(Math.max(50,right-left)*Math.max(50,bottom-top))),w=Math.min(layer.canvas.width,Math.max(side,right-left)),h=Math.min(layer.canvas.height,Math.max(side,bottom-top));left=Math.max(0,Math.min(layer.canvas.width-w,Math.trunc((left+right-w)/2)));top=Math.max(0,Math.min(layer.canvas.height-h,Math.trunc((top+bottom-h)/2)));right=left+w;bottom=top+h;}
    if(right<=left||bottom<=top)return Promise.resolve(null);const width=right-left,height=bottom-top,coverage=surface(width,height),local=points.map(p=>({x:p.x-layer.x-left,y:p.y-layer.y-top}));
    for(let i=0;i<local.length;i++)paintRasterStroke(coverage,i?local[i-1]:local[i],local[i],{width:options.width,hardness:options.hardness,color:'#ffffff',opacity:1});
    const weights=coverage.getContext('2d').getImageData(0,0,width,height).data,mask=new Uint8Array(width*height);for(let i=0;i<width*height;i++)mask[i]=weights[i*4+3]>0?1:0;
    const sampled=surface(width,height);sampled.getContext('2d').drawImage(source,-left-layer.x+offset.x,-top-layer.y+offset.y);
    const src=sampled.getContext('2d').getImageData(0,0,width,height).data,dst=layer.canvas.getContext('2d').getImageData(left,top,width,height).data,baseline=new Uint8ClampedArray(dst),worker=new Worker(new URL('./retouch-worker.js',import.meta.url),{type:'module'});this.worker=worker;
    return new Promise((resolve,reject)=>{this.reject=reject;const done=()=>{worker.terminate();if(this.worker===worker){this.worker=null;this.reject=null;}};
      worker.onmessage=event=>{done();if(event.data.error){reject(Error(event.data.error));return;}const result=new Uint8ClampedArray(event.data.buffer);for(let i=0;i<width*height;i++){const j=i*4,w=weights[j+3]/255*options.opacity,oldAlpha=baseline[j+3]/255,newAlpha=result[j+3]/255,a=oldAlpha*(1-w)+newAlpha*w;for(let c=0;c<3;c++)result[j+c]=a?(baseline[j+c]*oldAlpha*(1-w)+result[j+c]*newAlpha*w)/a:0;result[j+3]=a*255;}resolve({x:left,y:top,image:new ImageData(result,width,height)});};
      worker.onerror=event=>{done();reject(Error(event.message||'Healing failed.'));};worker.postMessage({width,height,source:src.buffer,destination:dst.buffer,mask:mask.buffer,spot:Boolean(options.spot),spotMode:options.spotMode,brushWidth:options.width},[src.buffer,dst.buffer,mask.buffer]);
    });
  }
}
