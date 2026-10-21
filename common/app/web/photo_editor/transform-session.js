import {copyCanvas,surface} from './engine.js';
import {deviceImageData,ensureDeviceSamples,placePerspectiveSamples,presentLayer,warpLayerNumbers} from './device-paint.js';
import {quadMapping,perspectivePixels} from './perspective.js';
import {BezierMesh,splitMesh,warpImage} from './warp-mesh.js';
import {presetMesh} from './warp-style.js';
import {pathBounds,transformPath} from './paths.js';
import {redrawTypeLayer} from './text-layout.js';
import {shapePath} from './shape-path.js';
import {warpPlacePixels} from './warp-place.js';
import {alphaSelection} from './selections.js';
import {reducedSides,scaleChannelBytes} from './seam.js';

const MODES={ 'edit.freeTransform':'free','edit.freeTransformCopy':'free','path.transform':'free','edit.transform.scale':'scale','edit.transform.rotate':'rotate','edit.transform.skew':'skew','edit.transform.distort':'distort','edit.transform.perspective':'perspective','edit.transform.warp':'warp' };
export const transformCommandIds=new Set([...Object.keys(MODES),'edit.transform.splitWarpHorizontally','edit.transform.splitWarpVertically','edit.transform.splitWarpCrosswise','edit.transform.removeWarpSplit']);
let contentAwareCarve=null;
export function registerContentAware(fn){contentAwareCarve=fn;}
const LABELS={free:'Free Transform',scale:'Scale',rotate:'Rotate',skew:'Skew',distort:'Distort',perspective:'Perspective',warp:'Warp'};
function modeChannels(mode){return mode==='cmyk'?4:mode==='gray'?1:3;}
function nearestBytes(src,sw,sh,ch,dw,dh){if(sw===dw&&sh===dh)return src;const out=new Uint8Array(dw*dh*ch);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const sx=Math.min(sw-1,Math.floor((x+.5)*sw/dw)),sy=Math.min(sh-1,Math.floor((y+.5)*sh/dh)),s=(sy*sw+sx)*ch,d=(y*dw+x)*ch;for(let c=0;c<ch;c++)out[d+c]=src[s+c];}return out;}
function nearestFloat(src,sw,sh,dw,dh){if(!src)return null;if(sw===dw&&sh===dh)return src;const out=new Float32Array(dw*dh);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const sx=Math.min(sw-1,Math.floor((x+.5)*sw/dw)),sy=Math.min(sh-1,Math.floor((y+.5)*sh/dh));out[y*dw+x]=src[sy*sw+sx];}return out;}
function bilinearBytes(src,sw,sh,ch,dw,dh){if(sw===dw&&sh===dh)return src;const out=new Uint8Array(dw*dh*ch);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const fx=Math.max(0,(x+.5)*sw/dw-.5),fy=Math.max(0,(y+.5)*sh/dh-.5),x0=Math.min(sw-1,Math.floor(fx)),y0=Math.min(sh-1,Math.floor(fy)),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),tx=Math.min(1,fx-x0),ty=Math.min(1,fy-y0);for(let c=0;c<ch;c++){const v=(src[(y0*sw+x0)*ch+c]*(1-tx)+src[(y0*sw+x1)*ch+c]*tx)*(1-ty)+(src[(y1*sw+x0)*ch+c]*(1-tx)+src[(y1*sw+x1)*ch+c]*tx)*ty;out[(y*dw+x)*ch+c]=Math.round(Math.max(0,Math.min(255,v)));}}return out;}
function packDevice(samples,alpha,n){const count=alpha.length,ch=n+1,out=new Uint8Array(count*ch);for(let i=0;i<count;i++){for(let c=0;c<n;c++)out[i*ch+c]=samples[i*n+c];out[i*ch+n]=alpha[i];}return out;}
function originalNumbers(tool){const doc=tool.document;if(!doc?.colorMode||doc.colorMode==='rgb'||!tool.original?.canvas)return null;if(!(tool.original.samples&&tool.original.deviceAlpha)){const holder={canvas:tool.original.canvas};ensureDeviceSamples(doc,holder);tool.original.samples=holder.deviceSamples;tool.original.deviceAlpha=holder.deviceAlpha;}const n=modeChannels(doc.colorMode),w=tool.original.canvas.width,h=tool.original.canvas.height;if(tool.original.samples?.length!==w*h*n||tool.original.deviceAlpha?.length!==w*h)return null;return {doc,n,w,h,samples:tool.original.samples,alpha:tool.original.deviceAlpha};}
function carveDevice(tool,preview){const info=originalNumbers(tool);if(!info)return false;const w0=Math.hypot(tool.base[1][0]-tool.base[0][0],tool.base[1][1]-tool.base[0][1])||1,h0=Math.hypot(tool.base[3][0]-tool.base[0][0],tool.base[3][1]-tool.base[0][1])||1,w1=Math.hypot(tool.quad[1][0]-tool.quad[0][0],tool.quad[1][1]-tool.quad[0][1]),h1=Math.hypot(tool.quad[3][0]-tool.quad[0][0],tool.quad[3][1]-tool.quad[0][1]),fullW=Math.max(1,Math.round(info.w*w1/w0)),fullH=Math.max(1,Math.round(info.h*h1/h0));if(fullW>32767||fullH>32767||fullW*fullH>64000000)throw Error(preview?'The projected image exceeds the image size limit.':'The scaled image exceeds the image size limit.');const ch=info.n+1,amount=Math.max(0,Math.min(100,Number(tool.contentAware.amount)||0))/100,packed=packDevice(info.samples,info.alpha,info.n);let guard=tool.protection({width:info.w,height:info.h}),skin=null;if(tool.contentAware.protectSkin){const view=deviceImageData(info.doc,{canvas:tool.original.canvas,deviceSamples:info.samples,deviceAlpha:info.alpha});if(view)skin=view.data;}let carved;if(preview){const [rw,rh,nw,nh]=reducedSides(info.w,info.h,fullW,fullH,384);carved=bilinearBytes(scaleChannelBytes(rw,rh,ch,nearestBytes(packed,info.w,info.h,ch,rw,rh),nw,nh,amount,nearestFloat(guard,info.w,info.h,rw,rh),skin?nearestBytes(skin,info.w,info.h,4,rw,rh):null),nw,nh,ch,fullW,fullH);}else{tool.document.checkpoint('Content-Aware Scale');carved=scaleChannelBytes(info.w,info.h,ch,packed,fullW,fullH,amount,guard,skin);}const samples=new Uint8Array(fullW*fullH*info.n),alpha=new Uint8Array(fullW*fullH);for(let i=0;i<alpha.length;i++){for(let c=0;c<info.n;c++)samples[i*info.n+c]=carved[i*ch+c];alpha[i]=carved[i*ch+info.n];}const layer=tool.layer;layer.canvas=surface(fullW,fullH);layer.deviceSamples=samples;layer.deviceAlpha=alpha;layer.x=Math.round(tool.original.x+(tool.quad[0][0]-tool.base[0][0]));layer.y=Math.round(tool.original.y+(tool.quad[0][1]-tool.base[0][1]));layer.text=null;layer.shape=null;layer._devicePaint=null;layer._colorDoc=info.doc;presentLayer(info.doc,layer);if(!preview){tool.document.dirty=true;tool.document.dispatchEvent(new Event('change'));}return true;}

function applyH(h,x,y){const d=h[6]*x+h[7]*y+1;if(!Number.isFinite(d)||Math.abs(d)<1e-10)return null;return [(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];}
function cornersOf(layer){const {x,y,canvas}=layer;return [[x,y],[x+canvas.width,y],[x+canvas.width,y+canvas.height],[x,y+canvas.height]];}
function turns(q){return q.map((_,k)=>{const a=q[k],b=q[(k+1)%4],c=q[(k+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});}
function keepConvex(from,to){
  const t0=turns(from),sign=Math.sign(t0[0]),min=Math.min(...t0.map(Math.abs))*1e-3;
  const convex=(q,limit)=>turns(q).every(t=>t*sign>limit);
  if(!(Number.isFinite(min)&&min>0&&convex(from,0))||convex(to,min))return to;
  let lo=0,hi=1;
  for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(convex(from.map((p,k)=>[p[0]+(to[k][0]-p[0])*mid,p[1]+(to[k][1]-p[1])*mid]),min))lo=mid;else hi=mid;}
  return from.map((p,k)=>[p[0]+(to[k][0]-p[0])*lo,p[1]+(to[k][1]-p[1])*lo]);
}
function rectangular(q){const e1=[q[1][0]-q[0][0],q[1][1]-q[0][1]],e2=[q[3][0]-q[0][0],q[3][1]-q[0][1]],opp=[q[2][0]-q[1][0],q[2][1]-q[1][1]],l1=Math.hypot(e1[0],e1[1])||1,l2=Math.hypot(e2[0],e2[1])||1;return Math.abs(e1[0]*e2[0]+e1[1]*e2[1])<1e-2*l1*l2&&Math.hypot(opp[0]-e2[0],opp[1]-e2[1])<1e-2;}
function sameQuad(a,b){return a.every((p,i)=>Math.abs(p[0]-b[i][0])<1e-6&&Math.abs(p[1]-b[i][1])<1e-6);}
function constrain8(dx,dy,prev){
  const len=Math.hypot(dx,dy);if(!len)return [0,0];
  const step=Math.PI/4,a=Math.atan2(dy,dx);let k=Math.round(a/step);
  if(prev&&Math.hypot(prev[0],prev[1])>0){const kp=Math.round(Math.atan2(prev[1],prev[0])/step);let off=a-kp*step;off=((off%(Math.PI*2))+Math.PI*2)%(Math.PI*2);off=Math.min(off,Math.PI*2-off);if(off<step/2+8*Math.PI/180)k=kp;}
  const ang=k*step,c=Math.cos(ang),s=Math.sin(ang),t=Math.max(0,dx*c+dy*s),clean=v=>Math.abs(v)<1e-9?0:v;return [clean(t*c),clean(t*s)];
}
function splitLayerSelection(document,layer){
  const cover=document.selectionCoverage(),image=read(layer.canvas),split=splitCoverage(image,cover,document.width,document.height,layer.x||0,layer.y||0);
  if(split.empty)return split;
  const linked=layer.mask&&layer.maskLinked!==false,mask=linked?splitCoverage(read(document.alignedMask(layer)),cover,document.width,document.height,layer.x||0,layer.y||0):null;
  const x=(layer.x||0)+split.x,y=(layer.y||0)+split.y;
  return {rest:split.rest,crop:split.crop,mask:mask&&!mask.empty?mask:null,quad:[[x,y],[x+split.crop.width,y],[x+split.crop.width,y+split.crop.height],[x,y+split.crop.height]],device:splitDevice(document,layer,split)};
}
function splitDevice(document,layer,split){
  if(split.empty||!document.colorMode||document.colorMode==='rgb'||!layer?.canvas)return null;
  const n=modeChannels(document.colorMode);
  if(!layer.deviceSamples)ensureDeviceSamples(document,layer);
  const samples=layer.deviceSamples,alpha=layer.deviceAlpha,w=layer.canvas.width,h=layer.canvas.height;
  if(!samples||samples.length!==w*h*n||!alpha||alpha.length!==w*h)return null;
  const x0=split.x,y0=split.y,cw=split.crop.width,ch=split.crop.height,restS=new Uint8Array(samples),restA=new Uint8Array(alpha),cropS=new Uint8Array(cw*ch*n),cropA=new Uint8Array(cw*ch),cover=document.selectionCoverage(),ox=layer.x||0,oy=layer.y||0;
  for(let y=y0;y<y0+ch;y++)for(let x=x0;x<x0+cw;x++){
    const dx=Math.floor(ox+x),dy=Math.floor(oy+y),k=(dx>=0&&dy>=0&&dx<document.width&&dy<document.height?cover[dy*document.width+dx]:0)/255;
    if(k<=0)continue;
    const s=y*w+x,d=(y-y0)*cw+(x-x0);
    for(let c=0;c<n;c++)cropS[d*n+c]=samples[s*n+c];
    cropA[d]=Math.round(alpha[s]*k);
    const keep=1-k;restA[s]=keep<=0?0:Math.round(alpha[s]*keep);
  }
  return {restS,restA,cropS,cropA,n,w,h,cw,ch};
}
function splitCoverage(image,cover,docW,docH,originX,originY){
  const w=image.width,h=image.height,data=image.data,rest=new Uint8ClampedArray(data);
  let cx0=w,cy0=h,cx1=0,cy1=0,sx0=w,sy0=h,sx1=0,sy1=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(data[(y*w+x)*4+3]>0){cx0=Math.min(cx0,x);cy0=Math.min(cy0,y);cx1=Math.max(cx1,x+1);cy1=Math.max(cy1,y+1);}
    const dx=Math.floor(originX+x),dy=Math.floor(originY+y),k=dx>=0&&dy>=0&&dx<docW&&dy<docH?cover[dy*docW+dx]:0;
    if(k>0){sx0=Math.min(sx0,x);sy0=Math.min(sy0,y);sx1=Math.max(sx1,x+1);sy1=Math.max(sy1,y+1);}
  }
  const x0=Math.max(cx0,sx0),y0=Math.max(cy0,sy0),x1=Math.min(cx1,sx1),y1=Math.min(cy1,sy1);
  if(x1<=x0||y1<=y0)return {empty:true};
  const cw=x1-x0,ch=y1-y0,crop=new Uint8ClampedArray(cw*ch*4);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const s=(y*w+x)*4,dx=Math.floor(originX+x),dy=Math.floor(originY+y),k=(dx>=0&&dy>=0&&dx<docW&&dy<docH?cover[dy*docW+dx]:0)/255,d=((y-y0)*cw+(x-x0))*4;
    if(k>0){crop[d]=data[s];crop[d+1]=data[s+1];crop[d+2]=data[s+2];crop[d+3]=Math.round(data[s+3]*k);const keep=1-k;if(keep<=0)rest[s]=rest[s+1]=rest[s+2]=rest[s+3]=0;else rest[s+3]=Math.round(data[s+3]*keep);}
  }
  return {empty:false,rest:new ImageData(rest,w,h),crop:new ImageData(crop,cw,ch),x:x0,y:y0};
}
function channelRecord(document,id){if(document.quickMask&&(id==='quick-mask'||document.quickMask.id===id))return document.quickMask;return document.channels.find(channel=>channel.id===id)||null;}
function coverBounds(cover,width,height){let x0=width,y0=height,x1=0,y1=0;for(let i=0;i<cover.length;i++)if(cover[i]){const x=i%width,y=Math.floor(i/width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return x1>x0?{x:x0,y:y0,w:x1-x0,h:y1-y0}:null;}
function read(canvas){return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);}
function put(result){const canvas=surface(result.width,result.height);canvas.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);return canvas;}

export function openTransform(state,document,mode,finish,target=null,extra=null){
  const kind=target?.kind||null,cas=Boolean(extra?.contentAware),same=state.transform?.kind==='transform'&&state.transform.document===document&&Boolean(state.transform.contentAware)===cas&&state.transform.target===kind&&(kind==='path'?state.transform.pathId===target.pathId:kind==='channel'?state.transform.channelId===target.channelId:state.transform.layer===document.active);
  if(same){state.transform.setMode(mode);return state.transform;}
  if(state.transform)finish?.(true);
  const session=new TransformSession(document,mode,target);if(cas)session.contentAware={amount:100};if(extra?.made){session.made=extra.made;session.madeId=extra.madeId;}state.transform=session;return session;
}

export class TransformSession{
  constructor(document,mode='free',target=null){
    this.kind='transform';this.document=document;this.layer=document.active;this.target=target?.kind||null;this.pathId=target?.pathId||null;this.channelId=target?.channelId||null;this.drag=null;this.splitTool=null;this.placing=false;this.placeQuick=false;this.placeAt=null;
    const layer=this.layer;
    this.original={canvas:layer?.canvas?copyCanvas(layer.canvas):null,samples:layer?.deviceSamples?new Uint8Array(layer.deviceSamples):null,deviceAlpha:layer?.deviceAlpha?new Uint8Array(layer.deviceAlpha):null,mask:layer?.mask?copyCanvas(layer.mask):null,vectorMask:layer?.vectorMask?structuredClone(layer.vectorMask):null,x:layer?.x||0,y:layer?.y||0,maskOffsetX:layer?.maskOffsetX||0,maskOffsetY:layer?.maskOffsetY||0,text:layer?.text?structuredClone(layer.text):null,shape:layer?.shape?structuredClone(layer.shape):null,dirty:document.dirty,path:this.pathId?structuredClone(document.paths.find(path=>path.id===this.pathId)):null,selection:document.selection?structuredClone(document.selection):null};
    this.selectionOutline=this.target==='selection';this.groupMembers=null;
    if(this.selectionOutline){const cover=document.selectionCoverage(),bounds=coverBounds(cover,document.width,document.height);if(!bounds)throw Error('Select an area to transform first.');const crop=new Uint8ClampedArray(bounds.w*bounds.h*4);for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++)crop[(y*bounds.w+x)*4+3]=cover[(y+bounds.y)*document.width+x+bounds.x];const x=bounds.x,y=bounds.y;this.lift={rest:new ImageData(document.width,document.height),crop:new ImageData(crop,bounds.w,bounds.h),mask:null,quad:[[x,y],[x+bounds.w,y],[x+bounds.w,y+bounds.h],[x,y+bounds.h]]};this.quad=this.lift.quad.map(p=>p.slice());}
    else if(layer?.kind==='group'&&!this.target){const ids=document.descendants(layer.id);this.groupMembers=document.layers.filter(item=>ids.has(item.id)&&item!==layer&&item.kind!=='group'&&item.canvas).map(item=>({id:item.id,image:read(item.canvas),samples:document.colorMode!=='rgb'&&item.deviceSamples?new Uint8Array(item.deviceSamples):null,deviceAlpha:document.colorMode!=='rgb'&&item.deviceAlpha?new Uint8Array(item.deviceAlpha):null,x:item.x||0,y:item.y||0,mask:item.mask&&item.maskLinked!==false?read(item.mask):null,maskOffsetX:item.maskOffsetX||0,maskOffsetY:item.maskOffsetY||0,text:item.text?structuredClone(item.text):null,shape:item.shape?structuredClone(item.shape):null}));let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const item of this.groupMembers){x0=Math.min(x0,item.x);y0=Math.min(y0,item.y);x1=Math.max(x1,item.x+item.image.width);y1=Math.max(y1,item.y+item.image.height);}if(!this.groupMembers.length||!(x1>x0)||!(y1>y0))throw Error('Could not transform: the layer is empty.');this.quad=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
    else if(this.target==='channel'){const channel=channelRecord(document,this.channelId);if(!channel?.canvas)throw Error('That channel cannot be transformed.');this.original.channel=copyCanvas(channel.canvas);const image=read(channel.canvas),cover=document.selection?document.selectionCoverage():new Uint8ClampedArray(document.width*document.height).fill(255),split=splitCoverage(image,cover,document.width,document.height,0,0);if(!split.empty){const x=split.x,y=split.y;this.lift={rest:split.rest,crop:split.crop,mask:null,quad:[[x,y],[x+split.crop.width,y],[x+split.crop.width,y+split.crop.height],[x,y+split.crop.height]]};this.quad=this.lift.quad.map(p=>p.slice());}else if(document.selection){const bounds=coverBounds(document.selectionCoverage(),document.width,document.height);if(!bounds)throw Error('Could not transform: nothing is selected.');const crop=new Uint8ClampedArray(bounds.w*bounds.h*4);for(let y=0;y<bounds.h;y++)crop.set(image.data.subarray(((y+bounds.y)*image.width+bounds.x)*4,((y+bounds.y)*image.width+bounds.x+bounds.w)*4),y*bounds.w*4);this.lift={rest:image,crop:new ImageData(crop,bounds.w,bounds.h),mask:null,quad:[[bounds.x,bounds.y],[bounds.x+bounds.w,bounds.y],[bounds.x+bounds.w,bounds.y+bounds.h],[bounds.x,bounds.y+bounds.h]]};this.quad=this.lift.quad.map(p=>p.slice());}else{this.lift=null;this.quad=[[0,0],[document.width,0],[document.width,document.height],[0,document.height]];}}
    else{this.lift=!this.target&&layer?.canvas&&!layer.text&&!layer.shape&&layer.kind!=='smart'&&document.selection?splitLayerSelection(document,layer):null;if(this.lift?.empty)throw Error('Could not transform: the layer is empty.');}
    if(this.target!=='channel'&&!this.selectionOutline&&!this.groupMembers){if(this.target==='path'&&this.original.path){const b=pathBounds(this.original.path);this.quad=[[b.x,b.y],[b.x+Math.max(1,b.w),b.y],[b.x+Math.max(1,b.w),b.y+Math.max(1,b.h)],[b.x,b.y+Math.max(1,b.h)]];}
    else if(this.target==='mask'&&layer?.mask){const x=layer.x+(layer.maskOffsetX||0),y=layer.y+(layer.maskOffsetY||0);this.quad=[[x,y],[x+layer.mask.width,y],[x+layer.mask.width,y+layer.mask.height],[x,y+layer.mask.height]];}
    else if(this.lift)this.quad=this.lift.quad.map(p=>p.slice());
    else this.quad=cornersOf(layer);}
    this.base=this.quad.map(p=>p.slice());
    this.pivot=[(this.quad[0][0]+this.quad[2][0])/2,(this.quad[0][1]+this.quad[2][1])/2];
    this.mesh=null;this.initialMesh=null;this.typeWarp=false;this.style={name:'custom',bend:0,h:0,v:0,vertical:false};this.mode='free';this.grid='default';this.aspectLinked=true;this.skewH=0;this.skewV=0;this.interpolation='bicubic';this.steps={undo:[],redo:[],settled:null};this.setMode(mode);if(this.steps)this.steps.settled=this.snapshot();
  }
  setMode(mode){
    if(this.contentAware&&mode!=='free'&&mode!=='scale')return;
    if(mode==='warp'&&(this.target==='mask'||this.target==='channel'||this.selectionOutline))return;
    this.mode=mode;this.splitTool=null;this.placing=false;
    if(mode==='warp'){
      const rect=[this.base[0][0],this.base[0][1],this.base[2][0],this.base[2][1]];
      const unit=[{x:rect[0],y:rect[1]},{x:rect[2],y:rect[1]},{x:rect[2],y:rect[3]},{x:rect[0],y:rect[3]}];
      const mapped=quadMapping(unit,this.quad.map(([x,y])=>({x,y})));
      const place=p=>{const q=applyH(mapped,p[0],p[1]);return q||p;};
      if(this.layer?.text&&this.target!=='path'&&this.target!=='mask'&&this.target!=='channel'){this.typeWarp=true;const text=this.layer.text,known=['arc','arcLower','arcUpper','arch','bulge','shellLower','shellUpper','flag','wave','fish','rise','fisheye','inflate','squeeze','twist'];this.style={name:known.includes(text.warpStyle)?text.warpStyle:'none',bend:Number(text.warpBend)||0,h:Number(text.warpHorizontal)||0,v:Number(text.warpVertical)||0,vertical:text.warpAxis==='vertical'};this.mesh=null;this.preview();return;}
      const saved=this.layer?.kind==='smart'&&sameQuad(this.quad,this.base)?this.layer.smartWarp:null;
      if(saved?.us&&saved?.vs&&saved?.points){this.typeWarp=false;this.style={name:saved.style?.name||'custom',bend:Number(saved.style?.bend)||0,h:Number(saved.style?.h)||0,v:Number(saved.style?.v)||0,vertical:Boolean(saved.style?.vertical)};this.mesh=new BezierMesh(saved.us.slice(),saved.vs.slice(),saved.points.map(point=>Array.isArray(point)?point.slice():[point.x,point.y]));}
      else{this.typeWarp=false;this.style={name:'custom',bend:0,h:0,v:0,vertical:false};this.mesh=BezierMesh.identity(rect);}
      this.mesh.points=this.mesh.points.map(place);
      this.initialMesh=this.mesh.points.map(p=>p.slice());
    }else{this.mesh=null;this.typeWarp=false;}
  }
  sourceRect(){return [this.base[0][0],this.base[0][1],this.base[2][0],this.base[2][1]];}
  placeMesh(mesh){const rect=this.sourceRect(),unit=[{x:rect[0],y:rect[1]},{x:rect[2],y:rect[1]},{x:rect[2],y:rect[3]},{x:rect[0],y:rect[3]}],mapped=quadMapping(unit,this.quad.map(([x,y])=>({x,y})));mesh.points=mesh.points.map(p=>applyH(mapped,p[0],p[1])||p);return mesh;}
  rebuildWarp(){
    const rect=this.sourceRect();
    if(this.style.name==='custom'){if(!this.mesh)this.mesh=this.placeMesh(BezierMesh.identity(rect));}
    else if(this.style.name==='none')this.mesh=this.placeMesh(BezierMesh.identity(rect));
    else this.mesh=this.placeMesh(presetMesh(this.style.name,this.style.bend,rect,this.style.h,this.style.v,this.style.vertical)||BezierMesh.identity(rect));
    this.preview();
  }
  setStyle(name){if(this.mode!=='warp')return;if(name==='custom'){this.style.name='custom';this.grid='custom';return;}if(name!=='none'&&!this.style.bend)this.style.bend=50;this.style.name=name;this.grid='default';this.rebuildWarp();}
  setWarpNumber(key,value){if(this.mode!=='warp'||this.style.name==='custom'||this.style.name==='none')return;this.style[key]=value;this.rebuildWarp();}
  setVertical(on){if(this.mode!=='warp'||this.style.name==='custom'||this.style.name==='none')return;this.style.vertical=on;this.rebuildWarp();}
  setGrid(n){if(this.mode!=='warp'||!this.mesh||this.typeWarp)return;const knots=Array.from({length:n+1},(_,i)=>i/n);this.mesh=BezierMesh.fit((s,t)=>this.mesh.eval(s,t),knots,knots);this.style.name='custom';this.grid=this.gridId();this.preview();}
  gridId(){if(!this.mesh)return 'default';const even=knots=>{const n=knots.length-1;return n>0&&knots.every((value,index)=>Math.abs(value-index/n)<1e-4);};const cols=this.mesh.us.length-1,rows=this.mesh.vs.length-1;if(cols===rows&&even(this.mesh.us)&&even(this.mesh.vs))return {1:'default',3:'3',4:'4',5:'5'}[cols]||'custom';return 'custom';}
  setSkew(skewH,skewV){
    const limit=89;skewH=Math.max(-limit,Math.min(limit,Number(skewH)||0));skewV=Math.max(-limit,Math.min(limit,Number(skewV)||0));
    const w0=Math.hypot(this.base[1][0]-this.base[0][0],this.base[1][1]-this.base[0][1]),h0=Math.hypot(this.base[3][0]-this.base[0][0],this.base[3][1]-this.base[0][1]);if(w0<1e-9||h0<1e-9)return;
    const q=this.quad,m=[[(q[1][0]-q[0][0])/w0,(q[1][1]-q[0][1])/w0],[(q[3][0]-q[0][0])/h0,(q[3][1]-q[0][1])/h0]];
    const skewVr=(this.skewV||0)*Math.PI/180,c0=m[0],c1=m[1],angle=Math.atan2(c0[1],c0[0])-skewVr,sx=Math.hypot(c0[0],c0[1])*Math.cos(skewVr),cs=Math.cos(angle),sn=Math.sin(angle);
    const gx=c1[0]*cs+c1[1]*sn,gy=-c1[0]*sn+c1[1]*cs,sy=gy,nh=skewH*Math.PI/180,nv=skewV*Math.PI/180;
    const rot=(x,y)=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)],nc0=rot(sx,sx*Math.tan(nv)),nc1=rot(-sy*Math.tan(nh),sy);
    const det=m[0][0]*m[1][1]-m[1][0]*m[0][1];if(Math.abs(det)<1e-12)return;
    const inv=[[m[1][1]/det,-m[0][1]/det],[-m[1][0]/det,m[0][0]/det]],map=(x,y)=>{const u=inv[0][0]*x+inv[1][0]*y,v=inv[0][1]*x+inv[1][1]*y;return [nc0[0]*u+nc1[0]*v,nc0[1]*u+nc1[1]*v];};
    const c=this.pivot,quad=q.map(p=>{const d=map(p[0]-c[0],p[1]-c[1]);return [c[0]+d[0],c[1]+d[1]];});
    if(quad.flat().every(Number.isFinite)){this.quad=quad;this.skewH=skewH;this.skewV=skewV;this.preview();}
  }
  syncSkew(){const w0=Math.hypot(this.base[1][0]-this.base[0][0],this.base[1][1]-this.base[0][1]),h0=Math.hypot(this.base[3][0]-this.base[0][0],this.base[3][1]-this.base[0][1]);if(w0<1e-9||h0<1e-9)return;const q=this.quad,c0=[(q[1][0]-q[0][0])/w0,(q[1][1]-q[0][1])/w0],c1=[(q[3][0]-q[0][0])/h0,(q[3][1]-q[0][1])/h0],skewV=(this.skewV||0)*Math.PI/180,angle=Math.atan2(c0[1],c0[0])-skewV,cs=Math.cos(angle),sn=Math.sin(angle),gx=c1[0]*cs+c1[1]*sn,gy=-c1[0]*sn+c1[1]*cs,skewH=Math.abs(gy)<1e-12?0:Math.atan(-gx/gy)*180/Math.PI;if(Number.isFinite(skewH))this.skewH=Math.max(-89,Math.min(89,skewH));}
  resetWarp(){if(this.mode!=='warp')return;this.splitTool=null;this.placing=false;if(this.typeWarp){this.style={name:'none',bend:0,h:0,v:0,vertical:false};this.preview();return;}this.style={name:'custom',bend:0,h:0,v:0,vertical:false};this.grid='default';this.mesh=this.placeMesh(BezierMesh.identity(this.sourceRect()));this.preview();}
  restore(){const base=this.original;if(this.selectionOutline){this.document.selection=base.selection?structuredClone(base.selection):null;this.document.dirty=base.dirty;return;}if(this.groupMembers){for(const member of this.groupMembers){const layer=this.document.layers.find(item=>item.id===member.id);if(!layer)continue;layer.canvas=put(member.image);layer.deviceSamples=member.samples?new Uint8Array(member.samples):null;layer.deviceAlpha=member.deviceAlpha?new Uint8Array(member.deviceAlpha):null;layer.x=member.x;layer.y=member.y;if(member.mask){layer.mask=put(member.mask);layer.maskOffsetX=member.maskOffsetX;layer.maskOffsetY=member.maskOffsetY;}layer.text=member.text?structuredClone(member.text):null;layer.shape=member.shape?structuredClone(member.shape):null;}this.document.dirty=base.dirty;return;}if(this.target==='channel'){const channel=channelRecord(this.document,this.channelId);if(channel&&base.channel)channel.canvas=copyCanvas(base.channel);this.document.dirty=base.dirty;return;}const layer=this.layer;if(layer&&base.canvas)Object.assign(layer,{canvas:copyCanvas(base.canvas),deviceSamples:base.samples?new Uint8Array(base.samples):null,deviceAlpha:base.deviceAlpha?new Uint8Array(base.deviceAlpha):null,mask:base.mask?copyCanvas(base.mask):null,vectorMask:base.vectorMask?structuredClone(base.vectorMask):null,x:base.x,y:base.y,maskOffsetX:base.maskOffsetX,maskOffsetY:base.maskOffsetY,text:base.text?structuredClone(base.text):null,shape:base.shape?structuredClone(base.shape):null});if(this.target==='path'&&base.path){const path=this.document.paths.find(item=>item.id===this.pathId);if(path){path.nodes=structuredClone(base.path.nodes);path.closed=base.path.closed;path.subpaths=structuredClone(base.path.subpaths||[]);} }this.document.dirty=base.dirty;}
  mapDoc(x,y){if(this.mode==='warp'&&this.mesh){const rect=this.sourceRect(),p=this.mesh.eval((x-rect[0])/((rect[2]-rect[0])||1),(y-rect[1])/((rect[3]-rect[1])||1));return {x:p[0],y:p[1]};}const h=quadMapping(this.base.map(([px,py])=>({x:px,y:py})),this.quad.map(([px,py])=>({x:px,y:py}))),p=applyH(h,x,y);return p?{x:p[0],y:p[1]}:{x,y};}
  applyPath(){const path=this.document.paths.find(item=>item.id===this.pathId),source=structuredClone(this.original.path);if(!path||!source)return;transformPath(source,(x,y)=>this.mapDoc(x,y));path.nodes=source.nodes;path.closed=source.closed;path.subpaths=source.subpaths;}
  warpPlaceSpec(){
    const width=this.layer.canvas.width,height=this.layer.canvas.height,ox=this.original.x,oy=this.original.y;
    return {frame:{x:0,y:0,width,height},quad:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],domain:{x:0,y:0,width,height},interpolation:this.interpolation||'bicubic',mesh:{us:this.mesh.us.slice(),vs:this.mesh.vs.slice(),points:this.mesh.points.map(([x,y])=>({x:x-ox,y:y-oy}))}};
  }
  applyVectorMask(){if(!this.original.vectorMask?.path||this.layer.vectorMask?.linked===false)return;const path=structuredClone(this.original.vectorMask.path);transformPath(path,(x,y)=>this.mapDoc(x,y));this.layer.vectorMask={...this.original.vectorMask,path};}
  commitMeshWarp(){
    const linked=this.original.mask&&this.layer.maskLinked!==false,maskImage=linked?read(this.document.alignedMask(this.layer)):null,spec=this.warpPlaceSpec(),numbers=this.document.colorMode&&this.document.colorMode!=='rgb'&&warpLayerNumbers(this.document,this.layer,spec,this.original.x,this.original.y),result=numbers?{x:this.layer.x-this.original.x,y:this.layer.y-this.original.y}:warpPlacePixels(read(this.layer.canvas),spec);
    this.document.checkpoint('Warp');
    if(this.layer.kind==='smart')this.layer.smartOperations=[...(this.layer.smartOperations||[]),{type:'warpPlace',...spec}];
    if(!numbers){this.layer.canvas=put(result);this.layer.x=this.original.x+result.x;this.layer.y=this.original.y+result.y;}this.layer.text=null;this.layer.shape=null;
    if(maskImage){const maskResult=warpPlacePixels(maskImage,spec);this.layer.mask=put(maskResult);this.layer.maskOffsetX=maskResult.x-result.x;this.layer.maskOffsetY=maskResult.y-result.y;}
    else if(this.original.mask){this.layer.maskOffsetX=(this.original.maskOffsetX||0)+this.original.x-this.layer.x;this.layer.maskOffsetY=(this.original.maskOffsetY||0)+this.original.y-this.layer.y;}
    this.applyVectorMask();
    this.document.dirty=true;this.document.dispatchEvent(new Event('change'));
  }
  affineSettings(){
    const b0=this.base,q=this.quad,w0=Math.hypot(b0[1][0]-b0[0][0],b0[1][1]-b0[0][1])||1,h0=Math.hypot(b0[3][0]-b0[0][0],b0[3][1]-b0[0][1])||1;
    const w1=Math.hypot(q[1][0]-q[0][0],q[1][1]-q[0][1]),h1=Math.hypot(q[3][0]-q[0][0],q[3][1]-q[0][1]);
    const angle=(Math.atan2(q[1][1]-q[0][1],q[1][0]-q[0][0])-Math.atan2(b0[1][1]-b0[0][1],b0[1][0]-b0[0][0]))*180/Math.PI;
    const cx=this.layer.canvas.width/2,cy=this.layer.canvas.height/2;
    return {x:(q[0][0]+q[2][0])/2-cx,y:(q[0][1]+q[2][1])/2-cy,scaleX:w1/w0,scaleY:h1/h0,angle,skewX:this.skewH||0,skewY:this.skewV||0,interpolation:this.interpolation||'bicubic'};
  }
  applyTypeAffine(){
    const text=structuredClone(this.original.text),b0=this.base,q=this.quad;
    const w0=Math.hypot(b0[1][0]-b0[0][0],b0[1][1]-b0[0][1])||1,h0=Math.hypot(b0[3][0]-b0[0][0],b0[3][1]-b0[0][1])||1;
    const w1=Math.hypot(q[1][0]-q[0][0],q[1][1]-q[0][1]),h1=Math.hypot(q[3][0]-q[0][0],q[3][1]-q[0][1]);
    const angle=(Math.atan2(q[1][1]-q[0][1],q[1][0]-q[0][0])-Math.atan2(b0[1][1]-b0[0][1],b0[1][0]-b0[0][0]))*180/Math.PI;
    text.scaleX=(Number(text.scaleX)||100)*(w1/w0);text.scaleY=(Number(text.scaleY)||100)*(h1/h0);text.angle=(Number(text.angle)||0)+angle;
    text.x=(Number(text.x)||0)+(q[0][0]-b0[0][0]);text.y=(Number(text.y)||0)+(q[0][1]-b0[0][1]);text.skew=(Number(text.skew)||0)+(this.skewH||0);
    redrawTypeLayer(this.layer,text);
  }
  applyShape(){
    const shape=this.original.shape,path=shapePath(shape),ox=this.original.x,oy=this.original.y;
    transformPath(path,(x,y)=>this.mapDoc(ox+x,oy+y));
    const b=pathBounds(path);
    this.layer.x=0;this.layer.y=0;
    redrawShapeLayer(this.layer,{...shape,type:'path',path,pathBounds:{...b},x:b.x,y:b.y,w:Math.max(b.w,1e-3),h:Math.max(b.h,1e-3),fillEnabled:shape.type==='line'?false:shape.fillEnabled,strokeEnabled:Boolean(shape.strokeEnabled||shape.type==='line')});
  }
  applyMask(){const layer=this.layer,image=read(this.original.mask),method=this.interpolation||'bilinear';layer.canvas=copyCanvas(this.original.canvas);const result=this.mode==='warp'&&this.mesh?warpImage(image,this.mesh,4,method):perspectivePixels(image,this.quad.map(([x,y])=>({x,y})),method);layer.mask=put(result);layer.maskOffsetX=result.x-layer.x;layer.maskOffsetY=result.y-layer.y;layer.text=this.original.text?structuredClone(this.original.text):null;layer.shape=this.original.shape?structuredClone(this.original.shape):null;}
  get changed(){
    if(this.typeWarp){const o=this.original.text||{},name=this.style.name==='custom'?'none':this.style.name;return (o.warpStyle||'none')!==name||Number(o.warpBend||0)!==Number(this.style.bend||0)||Number(o.warpHorizontal||0)!==Number(this.style.h||0)||Number(o.warpVertical||0)!==Number(this.style.v||0)||(o.warpAxis==='vertical')!==Boolean(this.style.vertical)||!sameQuad(this.quad,this.base);}
    return !sameQuad(this.quad,this.base)||Boolean(this.mesh&&(this.mesh.us.length!==2||this.mesh.vs.length!==2||this.mesh.points.some((p,i)=>p[0]!==this.initialMesh[i][0]||p[1]!==this.initialMesh[i][1])));
  }
  hit(point,zoom){
    const tol=9/zoom,q=this.quad;
    const corner=q.findIndex(p=>Math.hypot(p[0]-point.x,p[1]-point.y)<tol);if(corner>=0)return {kind:'corner',index:corner};
    if(this.mode!=='warp'&&Math.hypot(this.pivot[0]-point.x,this.pivot[1]-point.y)<tol)return {kind:'pivot'};
    const edges=[[q[0],q[1]],[q[1],q[2]],[q[2],q[3]],[q[3],q[0]]];
    const edge=edges.findIndex(([a,b])=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)return false;const t=Math.max(0,Math.min(1,((point.x-a[0])*(b[0]-a[0])+(point.y-a[1])*(b[1]-a[1]))/l/l)),x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]);return Math.hypot(point.x-x,point.y-y)<tol;});
    if(edge>=0)return {kind:'edge',index:edge};
    if(this.inside(point))return {kind:'inside'};
      if(!this.contentAware&&this.mode!=='distort'&&this.mode!=='skew'&&this.mode!=='warp'){const handle=this.rotateHandle(zoom);if(Math.hypot(handle[0]-point.x,handle[1]-point.y)<tol)return {kind:'outside'};if(q.some(p=>Math.hypot(p[0]-point.x,p[1]-point.y)<tol*3))return {kind:'outside'};}
    return null;
  }
  rotateHandle(zoom){const a=this.quad[0],b=this.quad[1],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;let nx=a[1]-b[1],ny=b[0]-a[0],len=Math.hypot(nx,ny)||1;nx/=len;ny/=len;const cx=(this.quad[0][0]+this.quad[2][0])/2,cy=(this.quad[0][1]+this.quad[2][1])/2;if((mx-cx)*nx+(my-cy)*ny<0){nx=-nx;ny=-ny;}const d=24/zoom;return [mx+nx*d,my+ny*d,mx,my];}
  rotateCursor(point,zoom){if(!point||this.contentAware||this.mode==='warp'||this.mode==='distort'||this.mode==='skew')return null;const tol=9/Math.max(.01,zoom),hit=this.hit(point,zoom),rotating=this.drag&&(this.drag.handle==='outside'||this.drag.handle==='rotate');if(!rotating&&hit&&hit.kind!=='outside')return null;if(!rotating&&!this.quad.some(corner=>Math.hypot(corner[0]-point.x,corner[1]-point.y)<=tol*3))return null;let best=0,dist=Infinity;this.quad.forEach((corner,index)=>{const gap=Math.hypot(corner[0]-point.x,corner[1]-point.y);if(gap<dist){dist=gap;best=index;}});const unit=to=>{const dx=to[0]-this.quad[best][0],dy=to[1]-this.quad[best][1],length=Math.hypot(dx,dy);return length>1e-9?[dx/length,dy/length]:null;},a=unit(this.quad[(best+1)%4]),b=unit(this.quad[(best+3)%4]);if(!a||!b)return null;const sx=a[0]+b[0],sy=a[1]+b[1],length=Math.hypot(sx,sy);return length>1e-9?{x:point.x,y:point.y,dx:sx/length,dy:sy/length}:null;}
  inside(point){let hit=false;for(let i=0,j=3;i<4;j=i++){const a=this.quad[i],b=this.quad[j];if((a[1]>point.y)!==(b[1]>point.y)&&point.x<(b[0]-a[0])*(point.y-a[1])/(b[1]-a[1]||1e-9)+a[0])hit=!hit;}return hit;}
  allows(hit){if(!hit)return false;if(this.contentAware&&hit.kind==='outside')return false;if(hit.kind==='pivot')return true;if(this.mode==='distort')return hit.kind==='corner'||hit.kind==='inside';if(this.mode==='skew')return hit.kind!=='outside';return true;}
  begin(point,zoom,event){
    this.pointer=point;
    if(this.mode==='warp'&&this.typeWarp)return false;
    if(this.mode==='warp'&&!this.typeWarp){
      const quick=Boolean(event?.altKey||event?.metaKey||event?.ctrlKey);
      if(this.splitTool||quick){this.placing=true;this.placeQuick=!this.splitTool;this.placeAt=point;this.drag={handle:'split',snap:false};return true;}
      const anchor=this.anchors().find(item=>Math.hypot(item.x-point.x,item.y-point.y)<9/zoom);
      const [s,t]=this.mesh.paramAt([point.x,point.y]),near=this.mesh.eval(s,t);
      if(!anchor&&Math.hypot(near[0]-point.x,near[1]-point.y)>12/zoom)return false;
      this.drag={handle:anchor?'point':'pull',index:anchor?.index,s,t,start:point,base:this.mesh.points.map(p=>p.slice()),snap:false};return true;
    }
    const hit=this.hit(point,zoom);
    if(event?.altKey&&hit&&(hit.kind==='inside'||hit.kind==='outside')){this.pivot=[point.x,point.y];this.drag={handle:'pivot',start:point,quad:this.quad.map(p=>p.slice()),pivot:this.pivot.slice(),snap:false};this.document.dispatchEvent(new Event('change'));return true;}
    if(!this.allows(hit))return false;
    this.drag={handle:hit.kind,index:hit.index,start:point,quad:this.quad.map(p=>p.slice()),pivot:this.pivot.slice(),snap:this.mode!=='distort'};return true;
  }
  move(point,shift=false,event){
    const drag=this.drag;if(!drag)return;this.pointer=point;
    if(this.placing){this.placeAt=point;return;}
    if(this.mode==='warp'&&!this.typeWarp){
      const delta=[point.x-drag.start.x,point.y-drag.start.y];
      if(drag.handle==='point')this.mesh.dragPoint(drag.base,drag.index,delta);else this.mesh.pull(drag.base,drag.s,drag.t,delta);
      this.preview();return;
    }
    const q0=drag.quad,dx=point.x-drag.start.x,dy=point.y-drag.start.y;
    if(drag.handle==='pivot'){this.quad=q0.map(p=>p.slice());this.pivot=[point.x,point.y];this.document.dispatchEvent(new Event('change'));return;}
    let next=q0.map(p=>p.slice());
    const type=Boolean(this.layer.text),command=Boolean(event?.metaKey||event?.ctrlKey);
    if(drag.handle==='inside'){let mx=dx,my=dy;if(shift){const prev=[this.quad[0][0]-q0[0][0],this.quad[0][1]-q0[0][1]];[mx,my]=constrain8(dx,dy,prev);}next=q0.map(p=>[p[0]+mx,p[1]+my]);}
    else if(drag.handle==='outside'||this.mode==='rotate'&&(drag.handle==='corner'||drag.handle==='edge')){
      const c=drag.pivot;let da=Math.atan2(point.y-c[1],point.x-c[0])-Math.atan2(drag.start.y-c[1],drag.start.x-c[0]);
      if(shift){const base=Math.atan2(q0[1][1]-q0[0][1],q0[1][0]-q0[0][0]),step=15*Math.PI/180;da=Math.round((base+da)/step)*step-base;}
      const cs=Math.cos(da),sn=Math.sin(da);next=q0.map(p=>{const x=p[0]-c[0],y=p[1]-c[1];return [c[0]+x*cs-y*sn,c[1]+x*sn+y*cs];});
    }
    else if(this.mode==='skew'&&drag.handle==='corner'){
      const i=drag.index,along=j=>{const e=[q0[i][0]-q0[j][0],q0[i][1]-q0[j][1]],l=Math.hypot(e[0],e[1])||1,u=[e[0]/l,e[1]/l],t=dx*u[0]+dy*u[1];return [t*u[0],t*u[1]];};
      const hn=[1,0,3,2][i],vn=[3,2,1,0][i],h=along(hn),v=along(vn),useH=Math.hypot(h[0],h[1])>=Math.hypot(v[0],v[1]),m=useH?h:v,partner=useH?hn:vn;
      next=q0.map(p=>p.slice());const moved=type?[i,partner]:[i];
      for(let k=0;k<4;k++){let sign=0;if(moved.includes(k))sign=1;else if(event?.altKey&&(type||k===(i+2)%4))sign=-1;if(sign)next[k]=[q0[k][0]+sign*m[0],q0[k][1]+sign*m[1]];}
      next=keepConvex(q0,next);
    }
    else if(this.mode==='skew'&&drag.handle==='edge'){
      const i=drag.index,a=i,b=(i+1)%4;let mx=dx,my=dy;const e=[q0[b][0]-q0[a][0],q0[b][1]-q0[a][1]],l2=e[0]*e[0]+e[1]*e[1],t=l2?(dx*e[0]+dy*e[1])/l2:0;mx=t*e[0];my=t*e[1];
      next=q0.map(p=>p.slice());next[a]=[q0[a][0]+mx,q0[a][1]+my];next[b]=[q0[b][0]+mx,q0[b][1]+my];
      if(event?.altKey){next[(i+2)%4]=[q0[(i+2)%4][0]-mx,q0[(i+2)%4][1]-my];next[(i+3)%4]=[q0[(i+3)%4][0]-mx,q0[(i+3)%4][1]-my];}
    }
    else if(this.mode==='distort'&&!type&&drag.handle==='corner'){next=q0.map(p=>p.slice());next[drag.index]=[q0[drag.index][0]+dx,q0[drag.index][1]+dy];next=keepConvex(q0,next);}
    else if(this.mode==='perspective'&&!type&&drag.handle==='corner'){
      const i=drag.index,horizontal=Math.abs(dx)>=Math.abs(dy),j={0:horizontal?1:3,1:horizontal?0:2,2:horizontal?3:1,3:horizontal?2:0}[i];
      const mx=horizontal?dx:0,my=horizontal?0:dy;next=q0.map(p=>p.slice());next[i]=[q0[i][0]+mx,q0[i][1]+my];next[j]=[q0[j][0]-mx,q0[j][1]-my];next=keepConvex(q0,next);
    }
    else if(this.mode==='free'&&!type&&command&&event?.altKey&&shift&&drag.handle==='corner'){
      const i=drag.index,horizontal=Math.abs(dx)>=Math.abs(dy),j={0:horizontal?1:3,1:horizontal?0:2,2:horizontal?3:1,3:horizontal?2:0}[i];
      const mx=horizontal?dx:0,my=horizontal?0:dy;next=q0.map(p=>p.slice());next[i]=[q0[i][0]+mx,q0[i][1]+my];next[j]=[q0[j][0]-mx,q0[j][1]-my];next=keepConvex(q0,next);
    }
    else if(this.mode==='free'&&!type&&command&&drag.handle==='corner'){next=q0.map(p=>p.slice());next[drag.index]=[q0[drag.index][0]+dx,q0[drag.index][1]+dy];next=keepConvex(q0,next);}
    else if(this.mode==='free'&&command&&drag.handle==='edge'){
      const i=drag.index,a=i,b=(i+1)%4;let mx=dx,my=dy;
      if(shift){const e=[q0[b][0]-q0[a][0],q0[b][1]-q0[a][1]],l2=e[0]*e[0]+e[1]*e[1],t=l2?(dx*e[0]+dy*e[1])/l2:0;mx=t*e[0];my=t*e[1];}
      next=q0.map(p=>p.slice());next[a]=[q0[a][0]+mx,q0[a][1]+my];next[b]=[q0[b][0]+mx,q0[b][1]+my];
      if(event?.altKey){next[(i+2)%4]=[q0[(i+2)%4][0]-mx,q0[(i+2)%4][1]-my];next[(i+3)%4]=[q0[(i+3)%4][0]-mx,q0[(i+3)%4][1]-my];}
    }
    else if(drag.handle==='corner'||drag.handle==='edge')next=this.scaleQuad(q0,drag,point,this.aspectLinked?shift:!shift,Boolean(event?.altKey));
    this.quad=next;this.pivot=this.carryPivot(drag.quad||this.quad,next,drag.pivot||this.pivot);if(this.mode!=='warp')this.syncSkew();this.preview();
  }
  carryPivot(q0,q,pivot0){const unit=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],inv=quadMapping(q0.map(([x,y])=>({x,y})),unit),h1=quadMapping(unit,q.map(([x,y])=>({x,y}))),uv=applyH(inv,pivot0[0],pivot0[1]);if(!uv)return pivot0.slice();const p=applyH(h1,uv[0],uv[1]);return p||pivot0.slice();}
  scaleQuad(q0,drag,point,shift,alt){
    const unit=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],from=q0.map(([x,y])=>({x,y})),inv=quadMapping(from,unit),h=quadMapping(unit,from),uv=applyH(inv,point.x,point.y);if(!uv)return q0;
    const pivot=applyH(inv,drag.pivot[0],drag.pivot[1])||[.5,.5];
    let r=[0,0,1,1];
    const spec={corner:[[0,0,0,0],[0,1,0,0],[0,1,1,1],[0,0,1,1]],edge:[[null,null,0,0],[0,1,null,null],[null,null,1,1],[0,0,null,null]]}[drag.handle][drag.index];
    if(spec[0]!=null)r[spec[1]?2:0]=uv[0];
    if(spec[2]!=null)r[spec[3]?3:1]=uv[1];
    const mu0=spec[0]!=null&&spec[1]===0,mu1=spec[0]!=null&&spec[1]===1,mv0=spec[2]!=null&&spec[3]===0,mv1=spec[2]!=null&&spec[3]===1;
    if(alt){if(mu0)r[2]=2*pivot[0]-r[0];if(mu1)r[0]=2*pivot[0]-r[2];if(mv0)r[3]=2*pivot[1]-r[1];if(mv1)r[1]=2*pivot[1]-r[3];}
    if(!shift&&drag.handle==='edge'){if(mu0||mu1){const k=Math.abs(r[2]-r[0]),c=alt?pivot[1]:.5;r[1]=c-k/2;r[3]=c+k/2;}else{const k=Math.abs(r[3]-r[1]),c=alt?pivot[0]:.5;r[0]=c-k/2;r[2]=c+k/2;}}
    if(!shift&&drag.handle==='corner'){const sx=r[2]-r[0],sy=r[3]-r[1],k=Math.max(Math.abs(sx),Math.abs(sy)),nx=k*Math.sign(sx||1),ny=k*Math.sign(sy||1),ax=alt?pivot[0]:mu0?r[2]:r[0],ay=alt?pivot[1]:mv0?r[3]:r[1],fx=alt?0.5:mu0?1:0,fy=alt?0.5:mv0?1:0;r[0]=ax-nx*fx;r[2]=r[0]+nx;r[1]=ay-ny*fy;r[3]=r[1]+ny;}
    if(Math.abs(r[2]-r[0])<.02||Math.abs(r[3]-r[1])<.02)return q0;
    return [[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].map(([x,y])=>applyH(h,x,y)||q0[0]);
  }
  release(point){
    if(this.placing&&this.mesh){const at=[(point||this.placeAt).x,(point||this.placeAt).y];const how=this.splitTool||this.quickKind(at);splitMesh(this.mesh,how,at);this.preview();}
    this.placing=false;this.placeAt=null;this.drag=null;
  }
  quickKind(at){
    const [s,t]=this.mesh.paramAt(at),w=Math.max(1,Math.abs(this.base[2][0]-this.base[0][0])),h=Math.max(1,Math.abs(this.base[2][1]-this.base[0][1])),su=Math.max(.02,Math.min(.12,8/w)),sv=Math.max(.02,Math.min(.12,8/h));
    const thirds=this.mesh.us.length===2,near=(knots,v,tol)=>knots.some(k=>k>0&&k<1&&Math.abs(k-v)<tol)||thirds&&[1/3,2/3].some(k=>Math.abs(k-v)<tol);
    const u=near(this.mesh.us,s,su),v=near(this.mesh.vs,t,sv);if(u&&!v)return 'horizontal';if(v&&!u)return 'vertical';return 'crosswise';
  }
  nudge(dx,dy){if(this.mode==='warp')return false;this.quad=this.quad.map(p=>[p[0]+dx,p[1]+dy]);this.pivot=[this.pivot[0]+dx,this.pivot[1]+dy];this.preview();return true;}
  scaleAboutPivot(kx,ky){const unit=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],from=this.quad.map(([x,y])=>({x,y})),h=quadMapping(unit,from),inv=quadMapping(from,unit),p=applyH(inv,this.pivot[0],this.pivot[1]);if(!p)return;const next=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>applyH(h,p[0]+(u-p[0])*kx,p[1]+(v-p[1])*ky));if(next.every(Boolean))this.quad=next;}
  rotateAboutPivot(da){const c=this.pivot,cs=Math.cos(da),sn=Math.sin(da);this.quad=this.quad.map(q=>{const x=q[0]-c[0],y=q[1]-c[1];return [c[0]+x*cs-y*sn,c[1]+x*sn+y*cs];});}
  turnBox(kx,ky,angle){if(this.mode==='warp')return false;this.scaleAboutPivot(kx,ky);this.rotateAboutPivot(angle);this.preview();return true;}
  snapshot(){return {quad:this.quad.map(p=>p.slice()),pivot:this.pivot.slice(),mesh:this.mesh?{us:this.mesh.us.slice(),vs:this.mesh.vs.slice(),points:this.mesh.points.map(p=>p.slice())}:null,style:{...this.style},skewH:this.skewH||0,skewV:this.skewV||0,mode:this.mode,grid:this.grid};}
  stepKey(step=this.snapshot()){const q=step.quad.map(p=>p.map(v=>Math.round(v*100)/100).join(',')).join(';'),m=step.mesh?step.mesh.points.map(p=>p.map(v=>Math.round(v*100)/100).join(',')).join(';')+'|'+step.mesh.us.join(',')+'|'+step.mesh.vs.join(','):'';return [q,step.pivot.map(v=>Math.round(v*100)/100).join(','),m,step.style?.name,step.style?.bend,step.style?.h,step.style?.v,step.style?.vertical,step.skewH,step.skewV,step.mode,step.grid].join('#');}
  settle(){if(this.drag||this.placing||!this.steps)return;const now=this.snapshot();if(this.steps.settled&&this.stepKey(this.steps.settled)===this.stepKey(now))return;if(this.steps.settled)this.steps.undo.push(this.steps.settled);this.steps.redo=[];this.steps.settled=now;}
  restoreStep(step){this.quad=step.quad.map(p=>p.slice());this.pivot=step.pivot.slice();this.skewH=step.skewH;this.skewV=step.skewV;this.style={...step.style};this.mode=step.mode;this.grid=step.grid;this.mesh=step.mesh?new BezierMesh(step.mesh.us.slice(),step.mesh.vs.slice(),step.mesh.points.map(p=>p.slice())):null;this.typeWarp=this.mode==='warp'&&Boolean(this.layer?.text)&&this.target!=='path'&&this.target!=='mask';this.steps.settled=step;this.preview();}
  canUndo(){if(this.drag||this.placing||!this.steps)return false;const now=this.snapshot();return this.steps.undo.length>0||Boolean(this.steps.settled&&this.stepKey(this.steps.settled)!==this.stepKey(now));}
  canRedo(){return !this.drag&&!this.placing&&Boolean(this.steps?.redo.length);}
  undoStep(){if(this.drag||this.placing)return false;this.settle();const prev=this.steps.undo.pop();if(!prev)return false;this.steps.redo.push(this.snapshot());this.restoreStep(prev);return true;}
  redoStep(){if(this.drag||this.placing)return false;this.settle();const next=this.steps.redo.pop();if(!next)return false;this.steps.undo.push(this.snapshot());this.restoreStep(next);return true;}
  armSplit(how){this.splitTool=how;}
  splitNow(how){if(!this.mesh)return false;const ok=splitMesh(this.mesh,how);if(ok)this.preview();return ok;}
  anchors(){if(!this.mesh)return [];const nx=this.mesh.nx(),ny=this.mesh.ny(),out=[];for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(i%3&&j%3)continue;const p=this.mesh.points[j*nx+i];out.push({index:j*nx+i,x:p[0],y:p[1],anchor:i%3===0&&j%3===0});}return out;}
  stamp(rest,restX,restY,warped){const x0=Math.min(restX,warped.x),y0=Math.min(restY,warped.y),width=Math.max(restX+rest.width,warped.x+warped.width)-x0,height=Math.max(restY+rest.height,warped.y+warped.height)-y0,canvas=surface(Math.max(1,width),Math.max(1,height)),ctx=canvas.getContext('2d'),under=surface(rest.width,rest.height),over=surface(warped.width,warped.height);under.getContext('2d').putImageData(rest,0,0);over.getContext('2d').putImageData(new ImageData(warped.data,warped.width,warped.height),0,0);ctx.drawImage(under,restX-x0,restY-y0);ctx.drawImage(over,warped.x-x0,warped.y-y0);return {canvas,x:x0,y:y0};}
  paintLift(){
    const method=this.interpolation||'bilinear',cell=this.lift.crop.width*this.lift.crop.height>400000?8:4,quad=this.quad.map(([x,y])=>({x,y}));
    if(this.lift.device){this.paintLiftNumbers(method,cell,quad);return;}
    const warped=this.mode==='warp'&&this.mesh?warpImage(this.lift.crop,this.mesh,cell,method):perspectivePixels(this.lift.crop,quad,method),placed=this.stamp(this.lift.rest,this.original.x,this.original.y,warped);
    this.layer.canvas=placed.canvas;this.layer.x=placed.x;this.layer.y=placed.y;this.layer.text=null;this.layer.shape=null;
    if(this.lift.mask){const maskWarped=this.mode==='warp'&&this.mesh?warpImage(this.lift.mask.crop,this.mesh,4,method):perspectivePixels(this.lift.mask.crop,quad,method),mask=this.stamp(this.lift.mask.rest,this.original.x,this.original.y,maskWarped);this.layer.mask=mask.canvas;this.layer.maskOffsetX=mask.x-placed.x;this.layer.maskOffsetY=mask.y-placed.y;}
    else if(this.original.mask){this.layer.maskOffsetX=(this.original.maskOffsetX||0)+this.original.x-this.layer.x;this.layer.maskOffsetY=(this.original.maskOffsetY||0)+this.original.y-this.layer.y;}
  }
  paintLiftNumbers(method,cell,quad){
    const dev=this.lift.device,warp=bytes=>{const data=new Uint8ClampedArray(dev.cw*dev.ch*4);for(let i=0;i<bytes.length;i++){data[i*4]=data[i*4+1]=data[i*4+2]=bytes[i];data[i*4+3]=255;}const image=new ImageData(data,dev.cw,dev.ch);return this.mode==='warp'&&this.mesh?warpImage(image,this.mesh,cell,method):perspectivePixels(image,quad,method);},color=[];
    for(let c=0;c<dev.n;c++){const plane=new Uint8Array(dev.cw*dev.ch);for(let i=0;i<plane.length;i++)plane[i]=dev.cropS[i*dev.n+c];color.push(warp(plane));}
    const alphaWarp=warp(dev.cropA),wx=alphaWarp.x,wy=alphaWarp.y,ww=alphaWarp.width,wh=alphaWarp.height,rx=this.original.x,ry=this.original.y,x0=Math.floor(Math.min(rx,wx)),y0=Math.floor(Math.min(ry,wy)),width=Math.ceil(Math.max(rx+dev.w,wx+ww))-x0,height=Math.ceil(Math.max(ry+dev.h,wy+wh))-y0;
    if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The transformed layer exceeds the image size limit.');
    const samples=new Uint8Array(width*height*dev.n),alpha=new Uint8Array(width*height),blit=(sx,sy,sw,sh,srcS,srcA,srcN)=>{for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const dx=Math.round(sx+x)-x0,dy=Math.round(sy+y)-y0;if(dx<0||dy<0||dx>=width||dy>=height)continue;const s=y*sw+x,d=dy*width+dx,sa=srcA[s]/255,da=alpha[d]/255,oa=sa+da*(1-sa);if(oa<=0)continue;for(let c=0;c<dev.n;c++)samples[d*dev.n+c]=Math.round((srcS[s*srcN+c]*sa+samples[d*dev.n+c]*da*(1-sa))/oa);alpha[d]=Math.round(oa*255);}};
    blit(rx,ry,dev.w,dev.h,dev.restS,dev.restA,dev.n);
    const warpS=new Uint8Array(ww*wh*dev.n),warpA=new Uint8Array(ww*wh);
    for(let i=0;i<ww*wh;i++){const cover=alphaWarp.data[i*4+3]/255;warpA[i]=Math.round(alphaWarp.data[i*4]*cover);for(let c=0;c<dev.n;c++)warpS[i*dev.n+c]=color[c].data[i*4];}
    blit(wx,wy,ww,wh,warpS,warpA,dev.n);
    const layer=this.layer;layer.canvas=surface(width,height);layer.deviceSamples=samples;layer.deviceAlpha=alpha;layer.x=x0;layer.y=y0;layer.text=null;layer.shape=null;layer._devicePaint=null;layer._colorDoc=this.document;presentLayer(this.document,layer);
    if(this.lift.mask){const maskWarped=this.mode==='warp'&&this.mesh?warpImage(this.lift.mask.crop,this.mesh,4,method):perspectivePixels(this.lift.mask.crop,quad,method),mask=this.stamp(this.lift.mask.rest,this.original.x,this.original.y,maskWarped);layer.mask=mask.canvas;layer.maskOffsetX=mask.x-x0;layer.maskOffsetY=mask.y-y0;}
    else if(this.original.mask){layer.maskOffsetX=(this.original.maskOffsetX||0)+this.original.x-layer.x;layer.maskOffsetY=(this.original.maskOffsetY||0)+this.original.y-layer.y;}
  }
  paintChannel(){const channel=channelRecord(this.document,this.channelId);if(!channel)return;const method=this.interpolation||'bilinear',quad=this.quad.map(([x,y])=>({x,y})),canvas=surface(this.document.width,this.document.height);if(this.lift){const warped=perspectivePixels(this.lift.crop,quad,method),placed=this.stamp(this.lift.rest,0,0,warped);canvas.getContext('2d').drawImage(placed.canvas,placed.x,placed.y);}else{const warped=perspectivePixels(read(this.original.channel),quad,method);canvas.getContext('2d').drawImage(put(warped),warped.x,warped.y);}channel.canvas=canvas;}
  paintSelection(){const method=this.interpolation||'bilinear',quad=this.quad.map(([x,y])=>({x,y})),warped=perspectivePixels(this.lift.crop,quad,method),placed=this.stamp(this.lift.rest,0,0,warped),canvas=surface(this.document.width,this.document.height);canvas.getContext('2d').drawImage(placed.canvas,placed.x,placed.y);const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),cover=new Uint8ClampedArray(canvas.width*canvas.height);for(let i=0;i<cover.length;i++)cover[i]=data.data[i*4+3];this.document.selection=alphaSelection(cover,canvas.width,canvas.height);}
  paintGroup(){const method=this.interpolation||'bilinear';for(const member of this.groupMembers){const layer=this.document.layers.find(item=>item.id===member.id);if(!layer)continue;const quad=[this.mapDoc(member.x,member.y),this.mapDoc(member.x+member.image.width,member.y),this.mapDoc(member.x+member.image.width,member.y+member.image.height),this.mapDoc(member.x,member.y+member.image.height)].map(point=>({x:point.x,y:point.y})),result=member.samples&&member.deviceAlpha&&this.document.colorMode!=='rgb'?placePerspectiveSamples(this.document,layer,member.samples,member.deviceAlpha,member.image.width,member.image.height,quad,method):perspectivePixels(member.image,quad,method);if(!(member.samples&&member.deviceAlpha&&this.document.colorMode!=='rgb')){layer.canvas=put(result);layer.x=result.x;layer.y=result.y;}layer.text=null;layer.shape=null;if(member.mask){const originX=member.x+member.maskOffsetX,originY=member.y+member.maskOffsetY,maskQuad=[this.mapDoc(originX,originY),this.mapDoc(originX+member.mask.width,originY),this.mapDoc(originX+member.mask.width,originY+member.mask.height),this.mapDoc(originX,originY+member.mask.height)].map(point=>({x:point.x,y:point.y})),mask=perspectivePixels(member.mask,maskQuad,method);layer.mask=put(mask);layer.maskOffsetX=mask.x-result.x;layer.maskOffsetY=mask.y-result.y;}}}
  protection(image){const id=this.contentAware?.protectId,channel=id&&this.document.channels?.find(item=>item.id===id);if(!channel?.canvas)return null;const data=channel.canvas.getContext('2d').getImageData(0,0,channel.canvas.width,channel.canvas.height).data,out=new Float32Array(image.width*image.height),ox=this.original.x||0,oy=this.original.y||0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const dx=Math.round(ox+x),dy=Math.round(oy+y);if(dx<0||dy<0||dx>=channel.canvas.width||dy>=channel.canvas.height)continue;out[y*image.width+x]=data[(dy*channel.canvas.width+dx)*4]/255;}return out;}
  paintCarvedPreview(){if(!contentAwareCarve){const quad=this.quad.map(([x,y])=>({x,y}));this.document.perspectiveLayer(quad,false,this.interpolation||'bilinear');return;}if(carveDevice(this,true))return;const src=read(this.original.canvas),w0=Math.hypot(this.base[1][0]-this.base[0][0],this.base[1][1]-this.base[0][1])||1,h0=Math.hypot(this.base[3][0]-this.base[0][0],this.base[3][1]-this.base[0][1])||1,w1=Math.hypot(this.quad[1][0]-this.quad[0][0],this.quad[1][1]-this.quad[0][1]),h1=Math.hypot(this.quad[3][0]-this.quad[0][0],this.quad[3][1]-this.quad[0][1]),fullW=Math.max(1,Math.round(src.width*w1/w0)),fullH=Math.max(1,Math.round(src.height*h1/h0)),[sw,sh,nw,nh]=reducedSides(src.width,src.height,fullW,fullH,384),small=new Uint8ClampedArray(sw*sh*4),guard=this.protection(src),smallGuard=guard&&new Float32Array(sw*sh);for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const sx=Math.min(src.width-1,Math.floor((x+.5)*src.width/sw)),sy=Math.min(src.height-1,Math.floor((y+.5)*src.height/sh));small.set(src.data.subarray((sy*src.width+sx)*4,(sy*src.width+sx)*4+4),(y*sw+x)*4);if(guard)smallGuard[y*sw+x]=guard[sy*src.width+sx];}const out=contentAwareCarve({data:small,width:sw,height:sh,protect:smallGuard,protectSkin:Boolean(this.contentAware.protectSkin)},nw,nh,Math.max(0,Math.min(100,Number(this.contentAware.amount)||0))/100),canvas=surface(fullW,fullH);canvas.getContext('2d').drawImage(put(out),0,0,fullW,fullH);this.layer.canvas=canvas;this.layer.x=Math.round(this.original.x+(this.quad[0][0]-this.base[0][0]));this.layer.y=Math.round(this.original.y+(this.quad[0][1]-this.base[0][1]));this.layer.text=null;this.layer.shape=null;}
  commitContentAware(){if(!contentAwareCarve)throw Error('Content-Aware Scale is unavailable.');if(carveDevice(this,false))return;const src=this.original.canvas,w0=Math.hypot(this.base[1][0]-this.base[0][0],this.base[1][1]-this.base[0][1])||1,h0=Math.hypot(this.base[3][0]-this.base[0][0],this.base[3][1]-this.base[0][1])||1,w1=Math.hypot(this.quad[1][0]-this.quad[0][0],this.quad[1][1]-this.quad[0][1]),h1=Math.hypot(this.quad[3][0]-this.quad[0][0],this.quad[3][1]-this.quad[0][1]),nw=Math.max(1,Math.round(src.width*w1/w0)),nh=Math.max(1,Math.round(src.height*h1/h0));if(nw>32767||nh>32767||nw*nh>64000000)throw Error('The scaled image exceeds the image size limit.');this.document.checkpoint('Content-Aware Scale');const full=read(src);full.protect=this.protection(full);full.protectSkin=Boolean(this.contentAware.protectSkin);const out=contentAwareCarve(full,nw,nh,Math.max(0,Math.min(100,Number(this.contentAware.amount)||0))/100);this.layer.canvas=put(out);this.layer.x=Math.round(this.original.x+(this.quad[0][0]-this.base[0][0]));this.layer.y=Math.round(this.original.y+(this.quad[0][1]-this.base[0][1]));this.layer.text=null;this.layer.shape=null;this.document.dirty=true;this.document.dispatchEvent(new Event('change'));}
  preview(){
    try{
      if(this.mode!=='warp'&&!this.contentAware)this.syncSkew();
      this.restore();
      if(this.contentAware){this.paintCarvedPreview();this.document.dispatchEvent(new Event('change'));return;}
      if(this.target==='channel'){this.paintChannel();this.document.dispatchEvent(new Event('change'));return;}
      if(this.selectionOutline){this.paintSelection();this.document.dispatchEvent(new Event('change'));return;}
      if(this.groupMembers){this.paintGroup();this.document.dispatchEvent(new Event('change'));return;}
      if(this.lift){this.paintLift();this.document.dispatchEvent(new Event('change'));return;}
      if(this.target==='path'){this.applyPath();this.document.dispatchEvent(new Event('change'));return;}
      if(this.target==='mask'){this.applyMask();this.document.dispatchEvent(new Event('change'));return;}
      if(this.typeWarp){const name=this.style.name==='custom'||this.style.name==='none'?'none':this.style.name;redrawTypeLayer(this.layer,{...this.original.text,warpStyle:name,warpBend:this.style.bend||0,warpHorizontal:this.style.h||0,warpVertical:this.style.v||0,warpAxis:this.style.vertical?'vertical':'horizontal'});this.document.dispatchEvent(new Event('change'));return;}
      if(this.layer?.text&&this.mode!=='warp'){if(['free','scale','rotate','skew'].includes(this.mode)&&rectangular(this.quad))this.document.transformLayer({...this.affineSettings()},false);else this.applyTypeAffine();this.document.dispatchEvent(new Event('change'));return;}
      if(this.layer?.shape&&this.target!=='mask'){this.applyShape();this.document.dispatchEvent(new Event('change'));return;}
      if(this.mode==='warp'&&this.mesh){
        const linked=this.original.mask&&this.layer.maskLinked!==false,maskImage=linked?read(this.document.alignedMask(this.layer)):null,spec=this.warpPlaceSpec(),numbers=this.document.colorMode&&this.document.colorMode!=='rgb'&&warpLayerNumbers(this.document,this.layer,spec,this.original.x,this.original.y),result=numbers?{x:this.layer.x-this.original.x,y:this.layer.y-this.original.y}:warpPlacePixels(read(this.layer.canvas),spec);
        if(!numbers){this.layer.canvas=put(result);this.layer.x=this.original.x+result.x;this.layer.y=this.original.y+result.y;}this.layer.text=null;this.layer.shape=null;
        if(maskImage){const maskResult=warpPlacePixels(maskImage,spec);this.layer.mask=put(maskResult);this.layer.maskOffsetX=maskResult.x-result.x;this.layer.maskOffsetY=maskResult.y-result.y;}
        else if(this.original.mask){this.layer.maskOffsetX=(this.original.maskOffsetX||0)+this.original.x-this.layer.x;this.layer.maskOffsetY=(this.original.maskOffsetY||0)+this.original.y-this.layer.y;}
        this.applyVectorMask();
      }else{
        const quad=this.quad.map(([x,y])=>({x,y}));
        this.document.perspectiveLayer(quad,false,this.interpolation||'bilinear');
        if(this.layer.text&&this.original.text)this.layer.text=structuredClone(this.original.text);
      }
    }catch{this.restore();}
  }
  draw(ctx,zoom){
    ctx.save();ctx.strokeStyle='#4db6ff';ctx.fillStyle='#fff';ctx.lineWidth=1/zoom;ctx.setLineDash([]);
    if(this.mode==='warp'&&this.mesh&&!this.typeWarp){
      const mesh=this.mesh,steps=24,line=at=>{ctx.beginPath();for(let i=0;i<=steps;i++){const p=at(i/steps);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);}ctx.stroke();};
      const knotsU=mesh.us.length===2?[0,1/3,2/3,1]:mesh.us,knotsV=mesh.vs.length===2?[0,1/3,2/3,1]:mesh.vs;
      ctx.setLineDash(mesh.us.length===2?[4/zoom,3/zoom]:[]);
      for(const u of knotsU)if(mesh.us.length>2||u!==0&&u!==1)line(t=>mesh.eval(u,t));
      for(const v of knotsV)if(mesh.vs.length>2||v!==0&&v!==1)line(s=>mesh.eval(s,v));
      ctx.setLineDash([]);line(t=>mesh.eval(0,t));line(t=>mesh.eval(1,t));line(s=>mesh.eval(s,0));line(s=>mesh.eval(s,1));
      const nx=mesh.nx();for(const point of this.anchors()){if(!point.anchor)continue;const i=point.index%nx,j=point.index/nx|0;ctx.beginPath();for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=i+di,y=j+dj;if(x<0||y<0||x>=nx||y>=mesh.ny()||x%3&&y%3)continue;const q=mesh.points[y*nx+x];ctx.moveTo(point.x,point.y);ctx.lineTo(q[0],q[1]);}ctx.stroke();}
      for(const point of this.anchors()){const s=point.anchor?6:4;ctx.fillRect(point.x-s/2/zoom,point.y-s/2/zoom,s/zoom,s/zoom);ctx.strokeRect(point.x-s/2/zoom,point.y-s/2/zoom,s/zoom,s/zoom);}
      if(this.placing&&this.placeAt){const [s,t]=mesh.paramAt([this.placeAt.x,this.placeAt.y]),how=this.splitTool||(this.placeQuick?this.quickKind([this.placeAt.x,this.placeAt.y]):'crosswise');ctx.setLineDash([5/zoom,4/zoom]);if(how!=='vertical')line(u=>mesh.eval(u,t));if(how!=='horizontal')line(v=>mesh.eval(s,v));}
    }else{
      const q=this.quad;ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.stroke();
      const handles=this.mode==='distort'?q.map((p,i)=>['corner',i,p]):[...q.map((p,i)=>['corner',i,p]),...[[0,1],[1,2],[2,3],[3,0]].map(([a,b],i)=>['edge',i,[(q[a][0]+q[b][0])/2,(q[a][1]+q[b][1])/2]])];
      if(!this.contentAware&&this.mode!=='distort'&&this.mode!=='skew'&&this.mode!=='warp'){const [hx,hy,mx,my]=this.rotateHandle(zoom);ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(hx,hy);ctx.stroke();ctx.beginPath();ctx.arc(hx,hy,4/zoom,0,Math.PI*2);ctx.fill();ctx.stroke();}
      ctx.beginPath();ctx.arc(this.pivot[0],this.pivot[1],4/zoom,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(this.pivot[0]-6/zoom,this.pivot[1]);ctx.lineTo(this.pivot[0]+6/zoom,this.pivot[1]);ctx.moveTo(this.pivot[0],this.pivot[1]-6/zoom);ctx.lineTo(this.pivot[0],this.pivot[1]+6/zoom);ctx.stroke();
      for(const [, ,p] of handles){ctx.fillRect(p[0]-3/zoom,p[1]-3/zoom,6/zoom,6/zoom);ctx.strokeRect(p[0]-3/zoom,p[1]-3/zoom,6/zoom,6/zoom);}
      const cursor=this.rotateCursor(this.drag?this.pointer:this.hover,zoom);if(cursor){const s=16/zoom,angle=Math.atan2(cursor.dy,cursor.dx);ctx.save();ctx.translate(cursor.x,cursor.y);ctx.rotate(angle);ctx.beginPath();ctx.arc(0,0,s*.55,-Math.PI*.85,Math.PI*.15);ctx.stroke();ctx.beginPath();ctx.moveTo(s*.15,-s*.55);ctx.lineTo(s*.55,-s*.15);ctx.lineTo(s*.05,-s*.05);ctx.closePath();ctx.fill();ctx.restore();}
    }
    ctx.restore();
  }
  finish(commit){
    if(this.selectionOutline||this.groupMembers){const changed=this.changed;this.restore();if(commit&&changed){this.document.checkpoint(this.selectionOutline?'Transform Selection':'Transform Group');this.preview();this.document.dirty=true;this.document.dispatchEvent(new Event('change'));}else this.document.dispatchEvent(new Event('change'));this.drag=null;return;}
    if(this.contentAware){const changed=this.changed;this.restore();if(commit&&changed)this.commitContentAware();else this.document.dispatchEvent(new Event('change'));this.drag=null;return;}
    if(this.target==='channel'){const changed=this.changed;this.restore();if(commit&&changed){this.document.checkpoint('Transform Channel');this.preview();this.document.dirty=true;this.document.dispatchEvent(new Event('change'));}else this.document.dispatchEvent(new Event('change'));this.drag=null;return;}
    if(this.target!=='path'&&!this.document.layers.includes(this.layer)){this.drag=null;return;}
    const changed=this.changed;this.restore();
    if(commit&&changed){
      const b0=this.base[0],b2=this.base[2];this.document.lastEditTransform={rect:[b0[0],b0[1],b2[0],b2[1]],quad:this.quad.map(p=>[p[0],p[1]]),interpolation:this.interpolation||'bicubic'};
      if(this.lift){this.document.checkpoint(LABELS[this.mode]||'Transform');this.preview();this.document.dirty=true;this.document.dispatchEvent(new Event('change'));this.drag=null;return;}
      if(this.layer?.text&&!this.target&&this.mode!=='warp'){this.document.checkpoint(LABELS[this.mode]||'Transform');this.preview();this.document.dirty=true;this.document.dispatchEvent(new Event('change'));this.drag=null;return;}
      if(!this.target&&['free','scale','rotate','skew'].includes(this.mode)&&!this.layer?.shape&&!this.layer?.text&&rectangular(this.quad)){this.document.transformLayer({...this.affineSettings(),label:LABELS[this.mode]||'Transform'},true);this.drag=null;return;}
      if(this.mode==='warp'&&this.mesh&&!this.target&&!this.typeWarp&&!this.layer?.shape&&!this.layer?.text){this.commitMeshWarp();this.drag=null;return;}
      this.document.checkpoint(this.target==='path'?'Transform Path':this.target==='mask'?'Transform Mask':(LABELS[this.mode]||'Transform'));
      if(this.target==='path'||this.target==='mask'||this.typeWarp||this.layer?.text&&this.mode!=='warp'||this.layer?.shape&&this.target!=='mask'||this.mode==='warp'&&this.mesh){this.preview();if(this.layer?.kind==='smart'&&this.mesh&&!this.layer.shape)this.layer.smartWarp={style:this.style,us:this.mesh.us.slice(),vs:this.mesh.vs.slice(),points:this.mesh.points.map(p=>p.slice())};this.document.dirty=true;this.document.dispatchEvent(new Event('change'));}
      else{const quad=this.quad.map(([x,y])=>({x,y}));this.document.perspectiveLayer(quad,false,this.interpolation||'bilinear');if(this.layer.kind==='smart')this.layer.smartOperations=[...(this.layer.smartOperations||[]),{type:'perspective',quad,interpolation:this.interpolation||'bilinear'}];}
    }else this.document.dispatchEvent(new Event('change'));
    this.drag=null;
  }
}

function dropFloating(api){const gesture=api.state.gesture;if(!gesture?.pixelMove||!gesture.floatBefore)return;const moved=gesture.last&&gesture.start&&(Math.round(gesture.last.x-gesture.start.x)||Math.round(gesture.last.y-gesture.start.y));if(moved)api.doc().undoStack.push({label:'Move',state:gesture.floatBefore,bytes:1,command:null});api.state.gesture=null;}
function clearUnselected(document,layer){const cover=document.selectionCoverage(),image=read(layer.canvas),data=image.data;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const dx=Math.floor((layer.x||0)+x),dy=Math.floor((layer.y||0)+y),k=dx>=0&&dy>=0&&dx<document.width&&dy<document.height?cover[dy*document.width+dx]/255:0;if(k<1)data[(y*image.width+x)*4+3]=Math.round(data[(y*image.width+x)*4+3]*k);}layer.canvas.getContext('2d').putImageData(image,0,0);}
export function runTransformCommand(id,api){
  if(!transformCommandIds.has(id))return false;
  const document=api.doc();if(!document)throw Error('Open a document first.');
  if(api.state.transform?.contentAware&&MODES[id]&&MODES[id]!=='free'&&MODES[id]!=='scale'){api.message?.('Content-Aware Scale only scales: commit or cancel it first.');return true;}
  if(api.state.transform?.kind==='selection'&&MODES[id]){if(MODES[id]==='warp'){api.message?.('A selection keeps the transform box.');return true;}api.state.transform.free.setMode(MODES[id]);api.draw?.();api.message?.('Selection transform: '+MODES[id]+'. Enter applies. Escape cancels.');return true;}
  if(id==='edit.freeTransformCopy'){if(api.state.transform)throw Error('Commit or cancel the transform first.');dropFloating(api);const before=document.active?.id;document.duplicate();const made=document.active;if(!made||made.id===before)throw Error('Select a layer to copy.');if(document.selection&&made.canvas&&!made.text&&!made.shape&&made.kind!=='smart'&&made.kind!=='group')clearUnselected(document,made);openTransform(api.state,document,'free',api.finishTransform,null,{made:'copy',madeId:made.id});api.message?.('Transforming a copy. Escape removes the copy.');api.draw?.();return true;}
  dropFloating(api);
  const pathTool=(id==='path.transform'||['path','direct','pen','freeformPen','curvaturePen'].includes(api.state.tool))&&document.activePath?.nodes?.length&&!(['path','direct'].includes(api.state.tool)&&document.active?.shape);
  const layer=document.active,channel=!pathTool?document.channelTarget:null;
  if(!pathTool&&!channel&&(!layer||document.isLocked(layer)||layer.kind==='adjustment'||layer.kind!=='group'&&!layer.canvas))throw Error('Select an unlocked pixel layer.');
  if(id.startsWith('edit.transform.splitWarp')||id==='edit.transform.removeWarpSplit'){
    const session=api.state.transform;if(session?.kind!=='transform'||session.mode!=='warp')throw Error('Open Warp first.');
    if(session.typeWarp)throw Error('Warp on type takes only the warp styles.');
    const how=id==='edit.transform.splitWarpHorizontally'?'horizontal':id==='edit.transform.splitWarpVertically'?'vertical':id==='edit.transform.splitWarpCrosswise'?'crosswise':'remove';
    if(how==='remove'){if(!session.splitNow('remove'))throw Error('Nothing to split or remove there.');api.message?.('Warp split removed.');}
    else{session.armSplit(how);api.message?.('Drag on the mesh and release to place the split. Option-click or Command-click splits at the pointer.');}
    api.draw?.();return true;
  }
  const mode=MODES[id];
  const target=pathTool?{kind:'path',pathId:document.activePath.id}:channel?{kind:'channel',channelId:channel.id}:layer?.editMask&&layer.mask&&layer.maskLinked===false?{kind:'mask'}:null;
  const session=openTransform(api.state,document,mode,api.finishTransform,target);
  if(session.contentAware&&mode!=='free'&&mode!=='scale'){api.message?.('Content-Aware Scale only scales: commit or cancel it first.');api.draw?.();return true;}
  if(mode==='warp'&&session.mode!=='warp'){api.message?.('A channel, an unlinked mask, or a selection stays in the transform box.');api.draw?.();return true;}
  const text={free:'Drag handles. Enter applies. Escape cancels.',scale:'Drag a handle to scale. Enter applies. Escape cancels.',rotate:'Drag a handle to rotate. Enter applies. Escape cancels.',skew:'Drag a side or corner to skew. Enter applies. Escape cancels.',distort:'Drag a corner. Edges and rotate do nothing. Enter applies. Escape cancels.',perspective:'Drag a corner to add perspective. Enter applies. Escape cancels.',warp:target?.kind==='path'?'Drag the box to transform the path. Enter applies. Escape cancels.':layer?.text?'Type keeps a warp style. Enter applies. Escape cancels.':'Drag the mesh. Enter applies. Escape cancels. Option-click places a split.'};
  const lead=channel?(document.selection?'Only the selected part of '+channel.name+' moves. ':channel.name+' moves on its own. '):document.selection&&!target&&!layer?.text&&!layer?.shape&&layer?.kind!=='smart'?'Only the selected pixels move. ':'';
  api.message?.(lead+text[mode]);api.draw?.();return true;
}
