import {paintRasterStroke} from './brush-engine.js';
import {fillMappedImage} from './clone-source.js';
import {surface} from './engine.js';
export class HealingTask{
  cancel(){this.worker?.terminate();this.worker=null;const reject=this.reject;this.reject=null;reject?.(new DOMException('Healing cancelled','AbortError'));}
  run(layer,source,points,offset,options){
    const pixels=options.destination||layer.canvas;
    const margin=options.width/2+3;let left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))-layer.x-margin)),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))-layer.y-margin)),right=Math.min(pixels.width,Math.ceil(Math.max(...points.map(p=>p.x))-layer.x+margin)),bottom=Math.min(pixels.height,Math.ceil(Math.max(...points.map(p=>p.y))-layer.y+margin));
    if(options.spot&&right>left&&bottom>top){const side=Math.round(4*Math.sqrt(Math.max(50,right-left)*Math.max(50,bottom-top))),w=Math.min(pixels.width,Math.max(side,right-left)),h=Math.min(pixels.height,Math.max(side,bottom-top));left=Math.max(0,Math.min(pixels.width-w,Math.trunc((left+right-w)/2)));top=Math.max(0,Math.min(pixels.height-h,Math.trunc((top+bottom-h)/2)));right=left+w;bottom=top+h;}
    if(right<=left||bottom<=top)return Promise.resolve(null);const width=right-left,height=bottom-top,coverage=surface(width,height),local=points.map(p=>({x:p.x-layer.x-left,y:p.y-layer.y-top}));
    for(let i=0;i<local.length;i++)paintRasterStroke(coverage,i?local[i-1]:local[i],local[i],{width:options.width,hardness:options.hardness,color:'#ffffff',opacity:1});
    const weights=coverage.getContext('2d').getImageData(0,0,width,height).data,mask=new Uint8Array(width*height);for(let i=0;i<width*height;i++)mask[i]=weights[i*4+3]>0?1:0;
    const sampled=surface(width,height);if(options.mapping)sampled.getContext('2d').putImageData(fillMappedImage(source,left+layer.x,top+layer.y,width,height,options.mapping),0,0);else sampled.getContext('2d').drawImage(source,-left-layer.x+offset.x,-top-layer.y+offset.y);
    const native=options.mapping?null:options.native,channels=native?native.n+1:4,src=native?packNative(native,left-(offset.x||0),top-(offset.y||0),width,height):sampled.getContext('2d').getImageData(0,0,width,height).data,dst=native?packNative(native,left,top,width,height):pixels.getContext('2d').getImageData(left,top,width,height).data,baseline=new Uint8ClampedArray(dst),worker=new Worker(new URL('./retouch-worker.js',import.meta.url),{type:'module'});this.worker=worker;
    return new Promise((resolve,reject)=>{this.reject=reject;const done=()=>{worker.terminate();if(this.worker===worker){this.worker=null;this.reject=null;}};
      worker.onmessage=event=>{done();if(event.data.error){reject(Error(event.data.error));return;}const result=new Uint8ClampedArray(event.data.buffer);for(let i=0;i<width*height;i++){const j=i*channels,w=weights[i*4+3]/255*options.opacity,oldAlpha=baseline[j+channels-1]/255,newAlpha=result[j+channels-1]/255,a=oldAlpha*(1-w)+newAlpha*w;for(let c=0;c<channels-1;c++)result[j+c]=a?(baseline[j+c]*oldAlpha*(1-w)+result[j+c]*newAlpha*w)/a:0;result[j+channels-1]=Math.round(a*255);}resolve(native?{x:left,y:top,width,height,native:true,channels,data:result}:{x:left,y:top,image:new ImageData(result,width,height)});};
      worker.onerror=event=>{done();reject(Error(event.message||'Healing failed.'));};worker.postMessage({width,height,source:src.buffer,destination:dst.buffer,mask:mask.buffer,spot:Boolean(options.spot),spotMode:options.spotMode,brushWidth:options.width,channels},[src.buffer,dst.buffer,mask.buffer]);
    });
  }
}
function packNative(native,left,top,width,height){const {samples,alpha,n}=native,lw=native.width,lh=native.height,channels=n+1,out=new Uint8ClampedArray(width*height*channels);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=left+x,sy=top+y;if(sx<0||sy<0||sx>=lw||sy>=lh)continue;const si=sy*lw+sx,di=(y*width+x)*channels;for(let c=0;c<n;c++)out[di+c]=samples[si*n+c];out[di+n]=alpha[si];}return out;}
