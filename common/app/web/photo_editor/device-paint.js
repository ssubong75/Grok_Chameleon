// Brush commit, matching photocraft_raster::to_rgba / from_rgba and
// photocraft_color::convert for the stroke that lands on a layer.
// Gray uses Rec.601. CMYK uses the document profile, else coated CMYK, relative + BPC.
// Lab uses the paint-path D50 constants from crates/color/src/convert.rs.
import {convertSamples} from './cms-convert.js';
import {renderDuotone} from './duotone.js';
import {perspectivePixels} from './perspective.js';
import {resamplePixels} from './resample.js';
import {warpPlacePixels} from './warp-place.js';
import {layerMatrix,transformedBounds} from './transforms.js';
import {applyCanvasInterpolation} from './interpolation-preferences.js';
import {cachedProfile,preloadProfiles,spaceName} from './cms-profiles.js';
import {eyedropperSizes} from './tool-options.js';
import {readIccModel} from './icc-lut.js';

preloadProfiles().catch(()=>{});

const PAINT_D50=[0.96422,1,0.82521];
const SRGB_TO_XYZ=[[0.436074,0.385064,0.143080],[0.222504,0.716878,0.060618],[0.013932,0.097104,0.714173]];
const XYZ_TO_SRGB=[[3.133856,-1.616867,-0.490615],[-0.978768,1.916142,0.033454],[0.071945,-0.228991,1.405243]];
function srgbToLinear(v){return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}
function linearToSrgb(v){const x=Math.max(0,Math.min(1,v));return x<=0.0031308?x*12.92:1.055*x**(1/2.4)-0.055;}
function mat3(m,v){return [m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];}
function labFinverse(t){return t>6/29?t*t*t:3*(6/29)**2*(t-4/29);}
function labF(t){const e=(6/29)**3;return t>e?Math.cbrt(t):t/(3*(6/29)**2)+4/29;}
export function rgbToGray(rgb){return 0.299*rgb[0]+0.587*rgb[1]+0.114*rgb[2];}
export function inkInMode(doc,hex){const mode=doc?.colorMode||'rgb';if(!mode||mode==='rgb'||typeof hex!=='string'||!/^#[0-9a-fA-F]{6}$/.test(hex))return null;const n=Number.parseInt(hex.slice(1),16),rgb=[(n>>16)/255,((n>>8)&255)/255,(n&255)/255];let values;if(mode==='gray')values=[Math.round(rgbToGray(rgb)*255)];else if(mode==='lab')values=srgbToLab(rgb).map(value=>Math.round(Math.max(0,Math.min(1,value))*255));else{const ink=cmykFromRgb(doc,new Float32Array(rgb));values=[0,1,2,3].map(index=>Math.round(Math.max(0,Math.min(1,ink[index]))*255));}return {mode,values,hex:hex.toLowerCase(),rgb:rgb.map(value=>Math.round(value*255))};}
export function labToSrgb(encoded){const l=encoded[0]*100,a=encoded[1]*255-128,b=encoded[2]*255-128,fy=(l+16)/116,fx=fy+a/500,fz=fy-b/200,xyz=[labFinverse(fx)*PAINT_D50[0],labFinverse(fy)*PAINT_D50[1],labFinverse(fz)*PAINT_D50[2]],lin=mat3(XYZ_TO_SRGB,xyz);return lin.map(linearToSrgb);}
export function srgbToLab(rgb){const lin=rgb.map(srgbToLinear),xyz=mat3(SRGB_TO_XYZ,lin),fx=labF(xyz[0]/PAINT_D50[0]),fy=labF(xyz[1]/PAINT_D50[1]),fz=labF(xyz[2]/PAINT_D50[2]);return [(116*fy-16)/100,((500*(fx-fy))+128)/255,((200*(fy-fz))+128)/255];}
function naiveRgbToCmyk(rgb){const k=1-Math.max(rgb[0],rgb[1],rgb[2]);if(k>=1-1e-6)return [0,0,0,1];const d=1-k;return [(1-rgb[0]-k)/d,(1-rgb[1]-k)/d,(1-rgb[2]-k)/d,k];}
function naiveCmykToRgb(c){const k=1-c[3];return [(1-c[0])*k,(1-c[1])*k,(1-c[2])*k];}
function cmykModel(doc){
  if(doc._paintCmyk&&doc._paintCmykBytes===doc.iccProfile)return doc._paintCmyk;
  let model=null;
  if(doc.iccProfile){try{const parsed=readIccModel(doc.iccProfile);if(parsed.space==='CMYK')model=parsed;}catch{model=null;}}
  if(!model){try{model=cachedProfile('coated-cmyk');}catch{model=null;}}
  doc._paintCmyk=model;doc._paintCmykBytes=doc.iccProfile||null;
  return model;
}
function grayModel(doc){
  if(doc?.iccProfile){try{const parsed=readIccModel(doc.iccProfile);if(parsed.space==='GRAY')return parsed;}catch{}}
  try{return cachedProfile(doc.profileName||'dot-gain-20-compat');}catch{return cachedProfile('dot-gain-20-compat');}
}
function srgbModel(){return cachedProfile('srgb');}
function channels(mode){return mode==='cmyk'?4:mode==='gray'?1:3;}
export function ensureDeviceSamples(doc,layer){
  const mode=doc.colorMode||'rgb',n=channels(mode),count=layer.canvas.width*layer.canvas.height;
  if(layer.deviceSamples&&layer.deviceSamples.length===count*n)return layer.deviceSamples;
  const image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),packed=new Uint8Array(count*n);
  if(mode==='gray'){for(let i=0,p=0;i<image.data.length;i+=4,p++)packed[p]=Math.round(rgbToGray([image.data[i]/255,image.data[i+1]/255,image.data[i+2]/255])*255);}
  else if(mode==='lab'){for(let i=0,p=0;i<image.data.length;i+=4,p+=3){const lab=srgbToLab([image.data[i]/255,image.data[i+1]/255,image.data[i+2]/255]);packed[p]=Math.round(Math.max(0,Math.min(1,lab[0]))*255);packed[p+1]=Math.round(Math.max(0,Math.min(1,lab[1]))*255);packed[p+2]=Math.round(Math.max(0,Math.min(1,lab[2]))*255);}}
  else{const rgb=new Float32Array(count*3);for(let i=0,p=0;i<image.data.length;i+=4,p+=3){rgb[p]=image.data[i]/255;rgb[p+1]=image.data[i+1]/255;rgb[p+2]=image.data[i+2]/255;}const ink=cmykFromRgb(doc,rgb);for(let i=0;i<packed.length;i++)packed[i]=Math.round(Math.max(0,Math.min(1,ink[i]))*255);}
  layer.deviceSamples=packed;layer._devicePaint=null;
  ensureDeviceAlpha(layer);
  return packed;
}
export function ensureDeviceAlpha(layer){
  const count=layer.canvas.width*layer.canvas.height;
  if(layer.deviceAlpha&&layer.deviceAlpha.length===count)return layer.deviceAlpha;
  const image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),alpha=new Uint8Array(count);
  for(let i=0;i<count;i++)alpha[i]=image.data[i*4+3];
  layer.deviceAlpha=alpha;
  return alpha;
}
export function rgbToCmyk(doc,rgb){return cmykFromRgb(doc,rgb instanceof Float32Array?rgb:new Float32Array(rgb));}
function cmykFromRgb(doc,rgb){
  const model=cmykModel(doc);
  if(!model){const out=new Float32Array(rgb.length/3*4);for(let i=0,j=0;i<rgb.length;i+=3,j+=4){const ink=naiveRgbToCmyk([rgb[i],rgb[i+1],rgb[i+2]]);out[j]=ink[0];out[j+1]=ink[1];out[j+2]=ink[2];out[j+3]=ink[3];}return out;}
  return convertSamples(srgbModel(),model,rgb,'relative',true);
}
export function cmykToRgb(doc,ink){
  const model=cmykModel(doc);
  if(!model){const out=new Float32Array(ink.length/4*3);for(let i=0,j=0;i<ink.length;i+=4,j+=3){const rgb=naiveCmykToRgb([ink[i],ink[i+1],ink[i+2],ink[i+3]]);out[j]=rgb[0];out[j+1]=rgb[1];out[j+2]=rgb[2];}return out;}
  return convertSamples(model,srgbModel(),ink,'relative',true);
}
export function brushPaintTarget(doc,layer){
  const mode=doc.colorMode||'rgb';
  if(mode==='rgb')return layer.canvas;
  ensureDeviceSamples(doc,layer);
  const existing=layer._devicePaint;
  if(existing&&existing.width===layer.canvas.width&&existing.height===layer.canvas.height&&layer._devicePaintMode===mode)return existing;
  const canvas=document.createElement('canvas');canvas.width=layer.canvas.width;canvas.height=layer.canvas.height;
  const image=canvas.getContext('2d').createImageData(canvas.width,canvas.height);
  const alpha=ensureDeviceAlpha(layer);
  const samples=layer.deviceSamples,n=channels(mode);
  if(mode==='cmyk'){
    const ink=new Float32Array(samples.length);for(let i=0;i<samples.length;i++)ink[i]=samples[i]/255;
    const rgb=cmykToRgb(doc,ink);
    for(let i=0,p=0;i<image.data.length;i+=4,p+=3){image.data[i]=Math.round(rgb[p]*255);image.data[i+1]=Math.round(rgb[p+1]*255);image.data[i+2]=Math.round(rgb[p+2]*255);image.data[i+3]=alpha[i/4];}
  }else if(mode==='lab'){
    for(let i=0,p=0;i<image.data.length;i+=4,p+=3){const rgb=labToSrgb([samples[p]/255,samples[p+1]/255,samples[p+2]/255]);image.data[i]=Math.round(rgb[0]*255);image.data[i+1]=Math.round(rgb[1]*255);image.data[i+2]=Math.round(rgb[2]*255);image.data[i+3]=alpha[i/4];}
  }else{
    for(let i=0,p=0;i<image.data.length;i+=4,p++){const g=samples[p];image.data[i]=image.data[i+1]=image.data[i+2]=g;image.data[i+3]=alpha[p];}
  }
  canvas.getContext('2d').putImageData(image,0,0);
  layer._devicePaint=canvas;layer._devicePaintMode=mode;
  return canvas;
}
function sampleRgb(doc,samples,at,n,mode){
  if(mode==='gray'){const g=samples[at];return [g,g,g];}
  if(mode==='lab'){const rgb=labToSrgb([samples[at]/255,samples[at+1]/255,samples[at+2]/255]);return rgb.map(v=>Math.round(Math.max(0,Math.min(1,v))*255));}
  const ink=new Float32Array(n);for(let c=0;c<n;c++)ink[c]=samples[at+c]/255;const rgb=cmykToRgb(doc,ink);return [0,1,2].map(i=>Math.round(Math.max(0,Math.min(1,rgb[i]))*255));
}
function storeRgb(doc,samples,at,n,mode,data,i,ink){
  if(ink?.mode===mode&&ink.values?.length===n&&data[i+3]===255&&data[i]===ink.rgb[0]&&data[i+1]===ink.rgb[1]&&data[i+2]===ink.rgb[2]){for(let c=0;c<n;c++)samples[at+c]=ink.values[c];return;}
  if(mode==='gray'){samples[at]=Math.round(rgbToGray([data[i]/255,data[i+1]/255,data[i+2]/255])*255);return;}
  if(mode==='lab'){const lab=srgbToLab([data[i]/255,data[i+1]/255,data[i+2]/255]);samples[at]=Math.round(Math.max(0,Math.min(1,lab[0]))*255);samples[at+1]=Math.round(Math.max(0,Math.min(1,lab[1]))*255);samples[at+2]=Math.round(Math.max(0,Math.min(1,lab[2]))*255);return;}
  const packed=cmykFromRgb(doc,new Float32Array([data[i]/255,data[i+1]/255,data[i+2]/255]));for(let c=0;c<n;c++)samples[at+c]=Math.round(Math.max(0,Math.min(1,packed[c]))*255);
}
export function deviceImageData(doc,layer){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas)return null;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer),n=channels(mode),width=layer.canvas.width,height=layer.canvas.height,image=new ImageData(width,height);
  for(let p=0;p<width*height;p++){const rgb=sampleRgb(doc,samples,p*n,n,mode),i=p*4;image.data[i]=rgb[0];image.data[i+1]=rgb[1];image.data[i+2]=rgb[2];image.data[i+3]=alpha[p];}
  return image;
}
function rgbaFromStored(doc,samples,alpha,width,height){const mode=doc.colorMode||'rgb',n=samples.length/alpha.length,image=new ImageData(width,height);for(let p=0;p<alpha.length;p++){const rgb=sampleRgb(doc,samples,p*n,n,mode),i=p*4;image.data[i]=rgb[0];image.data[i+1]=rgb[1];image.data[i+2]=rgb[2];image.data[i+3]=alpha[p];}return image;}
export function fadeDeviceSamples(doc,layer,beforeSamples,beforeAlpha,opacity,mode){const color=doc?.colorMode;if(!color||color==='rgb'||!layer?.canvas||!beforeSamples||!beforeAlpha)return false;const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer),count=layer.canvas.width*layer.canvas.height,n=color==='cmyk'?4:color==='gray'?1:3;if(beforeSamples.length!==count*n||beforeAlpha.length!==count||samples.length!==count*n||alpha.length!==count)return false;const k=Math.max(0,Math.min(1,Number(opacity)||0));if(!mode||mode==='source-over'){const nextS=new Uint8Array(samples.length),nextA=new Uint8Array(count);for(let i=0;i<count;i++){const ab=beforeAlpha[i]/255,aa=alpha[i]/255,ao=ab+(aa-ab)*k;nextA[i]=Math.round(Math.max(0,Math.min(1,ao))*255);for(let c=0;c<n;c++){const pb=beforeSamples[i*n+c]/255,pa=samples[i*n+c]/255,pm=pb*ab+(pa*aa-pb*ab)*k;nextS[i*n+c]=Math.round((ao>1e-9?pm/ao:0)*255);}}layer.deviceSamples=nextS;layer.deviceAlpha=nextA;layer._devicePaint=null;presentLayer(doc,layer);return true;}const w=layer.canvas.width,h=layer.canvas.height,before=rgbaFromStored(doc,beforeSamples,beforeAlpha,w,h),after=deviceImageData(doc,layer),mixed=document.createElement('canvas');mixed.width=w;mixed.height=h;const ctx=mixed.getContext('2d');ctx.putImageData(before,0,0);const over=document.createElement('canvas');over.width=w;over.height=h;over.getContext('2d').putImageData(after,0,0);ctx.globalCompositeOperation=mode;ctx.drawImage(over,0,0);const blend=ctx.getImageData(0,0,w,h),out=new Uint8ClampedArray(count*4);for(let i=0;i<out.length;i+=4){const ab=before.data[i+3]/255,aa=blend.data[i+3]/255,ao=ab+(aa-ab)*k;for(let c=0;c<3;c++){const pm=before.data[i+c]/255*ab+(blend.data[i+c]/255*aa-before.data[i+c]/255*ab)*k;out[i+c]=Math.round((ao>1e-9?pm/ao:0)*255);}out[i+3]=Math.round(Math.max(0,Math.min(1,ao))*255);}commitDeviceImage(doc,layer,out,{});return true;}
export function commitDeviceImage(doc,layer,after,options={}){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas||!after)return;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer),n=channels(mode),width=layer.canvas.width,count=width*layer.canvas.height,lock=Boolean(options.alphaLock);
  for(let p=0;p<count;p++){
    const i=p*4,w=options.weight?options.weight(p%width,(p/width)|0):1;
    if(w<=0)continue;
    const before=sampleRgb(doc,samples,p*n,n,mode),ba=alpha[p];
    let r=after[i],g=after[i+1],b=after[i+2],a=after[i+3];
    if(w<1||lock){const oa=ba/255,ea=a/255,mixed=lock?oa:oa*(1-w)+ea*w;r=mixed?(before[0]*oa*(1-w)+r*ea*w)/mixed:(lock?before[0]:0);g=mixed?(before[1]*oa*(1-w)+g*ea*w)/mixed:(lock?before[1]:0);b=mixed?(before[2]*oa*(1-w)+b*ea*w)/mixed:(lock?before[2]:0);a=(lock?oa:mixed)*255;}
    r=Math.round(r);g=Math.round(g);b=Math.round(b);a=Math.round(a);
    if(r===before[0]&&g===before[1]&&b===before[2]&&a===ba)continue;
    const pixel=new Uint8ClampedArray([r,g,b,a]);
    storeRgb(doc,samples,p*n,n,mode,pixel,0,options.ink);alpha[p]=pixel[3];
  }
  presentLayer(doc,layer);
}
export function paintSamples(doc,layer,bounds,draw,options={}){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas||!bounds||bounds.w<1||bounds.h<1)return;
  ensureDeviceSamples(doc,layer);
  const n=channels(mode),samples=layer.deviceSamples,alpha=ensureDeviceAlpha(layer),width=layer.canvas.width;
  const before=layer.canvas.getContext('2d').getImageData(bounds.x,bounds.y,bounds.w,bounds.h);
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const i=(y*bounds.w+x)*4,pixel=(bounds.y+y)*width+bounds.x+x,rgb=sampleRgb(doc,samples,pixel*n,n,mode);before.data[i]=rgb[0];before.data[i+1]=rgb[1];before.data[i+2]=rgb[2];before.data[i+3]=alpha[pixel];}
  const work=document.createElement('canvas');work.width=bounds.w;work.height=bounds.h;work.getContext('2d').putImageData(before,0,0);draw(work);
  const after=work.getContext('2d').getImageData(0,0,bounds.w,bounds.h),lock=Boolean(options.alphaLock);
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){
    const i=(y*bounds.w+x)*4,w=options.weight?options.weight(bounds.x+x,bounds.y+y):1;
    if(w<=0){after.data[i]=before.data[i];after.data[i+1]=before.data[i+1];after.data[i+2]=before.data[i+2];after.data[i+3]=before.data[i+3];continue;}
    if(w<1||lock){const oa=before.data[i+3]/255,ea=after.data[i+3]/255,a=lock?oa:oa*(1-w)+ea*w;for(let c=0;c<3;c++)after.data[i+c]=a?(before.data[i+c]*oa*(1-w)+after.data[i+c]*ea*w)/a:(lock?before.data[i+c]:0);after.data[i+3]=(lock?oa:a)*255;}
    if(after.data[i]===before.data[i]&&after.data[i+1]===before.data[i+1]&&after.data[i+2]===before.data[i+2]&&after.data[i+3]===before.data[i+3])continue;
    const pixel=(bounds.y+y)*width+bounds.x+x;storeRgb(doc,samples,pixel*n,n,mode,after.data,i,options.ink);alpha[pixel]=after.data[i+3];
  }
  const shown=layer.canvas.getContext('2d').getImageData(bounds.x,bounds.y,bounds.w,bounds.h);
  let preview;
  if(mode==='gray'){const device=new Float32Array(bounds.w*bounds.h);for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++)device[y*bounds.w+x]=samples[((bounds.y+y)*width+bounds.x+x)*n]/255;preview=convertSamples(grayModel(doc),srgbModel(),device,'relative',true);}
  else if(mode==='lab'){preview=new Float32Array(bounds.w*bounds.h*3);for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const at=((bounds.y+y)*width+bounds.x+x)*n,rgb=labToSrgb([samples[at]/255,samples[at+1]/255,samples[at+2]/255]),p=(y*bounds.w+x)*3;preview[p]=rgb[0];preview[p+1]=rgb[1];preview[p+2]=rgb[2];}}
  else{const ink=new Float32Array(bounds.w*bounds.h*n);for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const at=((bounds.y+y)*width+bounds.x+x)*n,p=(y*bounds.w+x)*n;for(let c=0;c<n;c++)ink[p+c]=samples[at+c]/255;}preview=cmykToRgb(doc,ink);}
  for(let i=0,p=0;i<shown.data.length;i+=4,p+=3){shown.data[i]=Math.round(Math.max(0,Math.min(1,preview[p]))*255);shown.data[i+1]=Math.round(Math.max(0,Math.min(1,preview[p+1]))*255);shown.data[i+2]=Math.round(Math.max(0,Math.min(1,preview[p+2]))*255);shown.data[i+3]=after.data[i+3];}
  layer.canvas.getContext('2d').putImageData(shown,bounds.x,bounds.y);layer._devicePaint=null;
}
export function refreshDevicePreview(doc,layer){
  const mode=doc.colorMode||'rgb';
  if(mode==='rgb'||!layer.canvas)return;
  ensureDeviceSamples(doc,layer);
  const width=layer.canvas.width,height=layer.canvas.height,count=width*height,samples=layer.deviceSamples,alpha=ensureDeviceAlpha(layer),image=layer.canvas.getContext('2d').getImageData(0,0,width,height);
  let preview;
  if(mode==='gray'&&doc.duotone?.inks?.length){preview=new Float32Array(count*3);for(let i=0;i<count;i++){const rgb=renderDuotone(doc.duotone,samples[i]/255),p=i*3;preview[p]=rgb[0];preview[p+1]=rgb[1];preview[p+2]=rgb[2];}}
  else if(mode==='gray'){const device=new Float32Array(count);for(let i=0;i<count;i++)device[i]=samples[i]/255;preview=convertSamples(grayModel(doc),srgbModel(),device,'relative',true);}
  else if(mode==='lab'){preview=new Float32Array(count*3);for(let i=0;i<count;i++){const rgb=labToSrgb([samples[i*3]/255,samples[i*3+1]/255,samples[i*3+2]/255]);preview[i*3]=rgb[0];preview[i*3+1]=rgb[1];preview[i*3+2]=rgb[2];}}
  else{const ink=new Float32Array(samples.length);for(let i=0;i<samples.length;i++)ink[i]=samples[i]/255;preview=cmykToRgb(doc,ink);}
  for(let i=0,p=0;i<image.data.length;i+=4,p+=3){image.data[i]=Math.round(Math.max(0,Math.min(1,preview[p]))*255);image.data[i+1]=Math.round(Math.max(0,Math.min(1,preview[p+1]))*255);image.data[i+2]=Math.round(Math.max(0,Math.min(1,preview[p+2]))*255);image.data[i+3]=alpha[i/4];}
  layer.canvas.getContext('2d').putImageData(image,0,0);layer._devicePaint=null;
}
export function mergeGrayDocument(doc,layers){
  const mode=doc?.colorMode,n=mode==='cmyk'?4:mode==='gray'?1:mode==='lab'?3:0;
  if(!n||!Array.isArray(layers))return null;
  const width=doc.width,height=doc.height,count=width*height,samples=new Uint8Array(count*n),alpha=new Uint8Array(count);
  if(mode==='lab')for(let i=0;i<count;i++){samples[i*3+1]=128;samples[i*3+2]=128;}
  for(const layer of layers){
    if(!layer||layer.visible===false)continue;
    if(layer.kind==='group'||layer.kind==='adjustment')return null;
    if((layer.blend||'source-over')!=='source-over'||(layer.fillOpacity??1)!==1||layer.vectorMask||layer.effects)return null;
    if(layer.mask&&!layer.maskDisabled&&(layer.maskFeather||(layer.maskDensity!=null&&layer.maskDensity!==1)))return null;
    if(!layer.canvas)return null;
    const src=ensureDeviceSamples(doc,layer),srcAlpha=ensureDeviceAlpha(layer),mask=layer.mask&&!layer.maskDisabled?layer.mask.getContext('2d').getImageData(0,0,layer.mask.width,layer.mask.height).data:null;
    if(src.length!==layer.canvas.width*layer.canvas.height*n)return null;
    const ox=Math.round(layer.x||0),oy=Math.round(layer.y||0),opacity=layer.opacity??1,mw=layer.mask?.width||0,mh=layer.mask?.height||0,mox=layer.maskOffsetX||0,moy=layer.maskOffsetY||0,outside=layer.maskDefault===255?1:0;
    for(let y=0;y<layer.canvas.height;y++){const dy=oy+y;if(dy<0||dy>=height)continue;for(let x=0;x<layer.canvas.width;x++){const dx=ox+x;if(dx<0||dx>=width)continue;const si=y*layer.canvas.width+x;let cover=1;if(mask){const mx=x-mox,my=y-moy;cover=mx<0||my<0||mx>=mw||my>=mh?outside:mask[(my*mw+mx)*4+3]/255;}const sa=srcAlpha[si]/255*opacity*cover;if(sa<=0)continue;const di=dy*width+dx;if(sa>=1){for(let c=0;c<n;c++)samples[di*n+c]=src[si*n+c];alpha[di]=255;continue;}const da=alpha[di]/255,oa=sa+da*(1-sa);for(let c=0;c<n;c++)samples[di*n+c]=Math.round((src[si*n+c]*sa+samples[di*n+c]*da*(1-sa))/oa);alpha[di]=Math.round(oa*255);}}
  }
  return {samples,alpha};
}
export function presentLayer(doc,layer){
  if(!doc||doc.colorMode==='rgb'||!layer?.canvas||layer.kind==='group'||layer.kind==='adjustment')return;
  refreshDevicePreview(doc,layer);
}
function modeChannels(mode){return mode==='cmyk'?4:mode==='gray'?1:3;}
export function layerDeviceRecord(doc,layer){
  const mode=doc?.colorMode;
  if(!mode||mode==='rgb'||!layer?.canvas||!layer.deviceSamples)return null;
  const n=modeChannels(mode),count=layer.canvas.width*layer.canvas.height;
  if(layer.deviceSamples.length!==count*n)return null;
  const alpha=new Uint8Array(ensureDeviceAlpha(layer));
  return {mode,width:layer.canvas.width,height:layer.canvas.height,samples:new Uint8Array(layer.deviceSamples),alpha,profileName:doc.profileName||null,icc:doc.iccProfile?new Uint8Array(doc.iccProfile):null};
}
export function flattenDeviceSamples(doc){
  const mode=doc?.colorMode;
  if(!mode||mode==='rgb')return null;
  const n=modeChannels(mode),width=doc.width,height=doc.height,samples=new Uint8Array(width*height*n),alpha=new Uint8Array(width*height);
  let any=false;
  for(const layer of doc.layers){
    if(layer.visible===false||layer.kind==='group'||layer.kind==='adjustment'||!layer.canvas||!layer.deviceSamples)continue;
    if(layer.deviceSamples.length!==layer.canvas.width*layer.canvas.height*n)return null;
    any=true;
    const alphaSrc=ensureDeviceAlpha(layer),ox=Math.round(layer.x||0),oy=Math.round(layer.y||0);
    for(let y=0;y<layer.canvas.height;y++){const dy=oy+y;if(dy<0||dy>=height)continue;for(let x=0;x<layer.canvas.width;x++){const dx=ox+x;if(dx<0||dx>=width)continue;const cover=alphaSrc[y*layer.canvas.width+x]/255;if(cover<=0)continue;const di=dy*width+dx,si=(y*layer.canvas.width+x)*n;for(let c=0;c<n;c++)samples[di*n+c]=Math.round(layer.deviceSamples[si+c]*cover+samples[di*n+c]*(1-cover));alpha[di]=Math.round((cover+(alpha[di]/255)*(1-cover))*255);}}
  }
  return any?{mode,width,height,samples,alpha,profileName:doc.profileName||null,icc:doc.iccProfile?new Uint8Array(doc.iccProfile):null}:null;
}
function channelImage(device,channel){
  const n=modeChannels(device.mode),count=device.width*device.height,data=new Uint8ClampedArray(count*4);
  for(let i=0;i<count;i++){const value=device.samples[i*n+channel];data[i*4]=data[i*4+1]=data[i*4+2]=value;data[i*4+3]=device.alpha[i];}
  return {width:device.width,height:device.height,data};
}
function packWarped(mode,warped,dx=0,dy=0){
  const n=modeChannels(mode),first=warped[0];
  if(warped.some(item=>item.width!==first.width||item.height!==first.height||item.x!==first.x||item.y!==first.y))throw Error('Device channels did not transform to the same bounds.');
  const samples=new Uint8Array(first.width*first.height*n),alpha=new Uint8Array(first.width*first.height);
  for(let i=0;i<alpha.length;i++){alpha[i]=first.data[i*4+3];for(let c=0;c<n;c++)samples[i*n+c]=warped[c].data[i*4];}
  return {mode,x:first.x+dx,y:first.y+dy,width:first.width,height:first.height,samples,alpha};
}
function warpDeviceRecord(device,quad,interpolation='bilinear'){
  const warped=[];
  for(let c=0;c<modeChannels(device.mode);c++)warped.push(perspectivePixels(channelImage(device,c),quad,interpolation));
  return packWarped(device.mode,warped);
}
function alignDevice(device){
  const ix=Math.floor(device.x),iy=Math.floor(device.y);
  if(ix===device.x&&iy===device.y)return device;
  const width=Math.ceil(device.x+device.width)-ix,height=Math.ceil(device.y+device.height)-iy,n=modeChannels(device.mode);
  const samples=new Uint8Array(width*height*n),alpha=new Uint8Array(width*height);
  for(let c=0;c<n;c++){
    const source=document.createElement('canvas');source.width=device.width;source.height=device.height;source.getContext('2d').putImageData(new ImageData(channelImage(device,c).data,device.width,device.height),0,0);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(source,device.x-ix,device.y-iy);
    const data=canvas.getContext('2d').getImageData(0,0,width,height).data;
    for(let i=0;i<width*height;i++){samples[i*n+c]=data[i*4];if(c===0)alpha[i]=data[i*4+3];}
  }
  return {...device,x:ix,y:iy,width,height,samples,alpha};
}
function resizeDevice(device,settings){
  const {scaleX,scaleY,method,canvasWidth,canvasHeight}=settings;
  if(![scaleX,scaleY].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid Smart Object resize scale.');
  const aligned=alignDevice(device),warped=[];
  for(let c=0;c<modeChannels(aligned.mode);c++)warped.push(resamplePixels(channelImage(aligned,c),aligned.x,aligned.y,scaleX,scaleY,method||'bicubic',canvasWidth,canvasHeight));
  return packWarped(aligned.mode,warped,Number(settings.offsetX)||0,Number(settings.offsetY)||0);
}
function transformDevice(device,settings){
  const matrix=layerMatrix({x:device.x,y:device.y,canvas:{width:device.width,height:device.height}},settings),bounds=transformedBounds(matrix,device.width,device.height);
  if(!Object.values(bounds).every(Number.isFinite)||bounds.width*bounds.height>64000000||bounds.width>32767||bounds.height>32767)throw Error('The transformed layer exceeds the image size limit.');
  const warped=[];
  for(let c=0;c<modeChannels(device.mode);c++){
    const source=document.createElement('canvas');source.width=device.width;source.height=device.height;source.getContext('2d').putImageData(new ImageData(channelImage(device,c).data,device.width,device.height),0,0);
    const output=document.createElement('canvas');output.width=bounds.width;output.height=bounds.height;const ctx=output.getContext('2d');
    applyCanvasInterpolation(ctx,settings.interpolation);ctx.setTransform(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds.x,matrix[5]-bounds.y);ctx.drawImage(source,0,0);
    warped.push({x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,data:ctx.getImageData(0,0,bounds.width,bounds.height).data});
  }
  return packWarped(device.mode,warped);
}
function warpPlaceDevice(device,operation){
  const warped=[];
  for(let c=0;c<modeChannels(device.mode);c++)warped.push(warpPlacePixels(channelImage(device,c),operation));
  return packWarped(device.mode,warped);
}
function profileForRecord(record){
  if(record?.icc){try{const parsed=readIccModel(record.icc);if(spaceName(parsed.space)===record.mode)return parsed;}catch{}}
  const id=record.mode==='cmyk'?'coated-cmyk':record.mode==='gray'?(record.profileName||'dot-gain-20-compat'):record.mode==='lab'?'lab-d50':'srgb';
  return cachedProfile(id);
}
function convertDeviceRecord(device,doc){
  if(device.mode===doc.colorMode)return device;
  const count=device.width*device.height,input=new Float32Array(device.samples.length);
  for(let i=0;i<input.length;i++)input[i]=device.samples[i]/255;
  const target=doc.colorMode&&doc.colorMode!=='rgb'?doc.colorMode:'rgb';
  const output=convertSamples(profileForRecord(device),profileForRecord({mode:target,icc:doc.iccProfile,profileName:doc.profileName}),input,'relative',true);
  const n=modeChannels(target),samples=target==='rgb'?null:new Uint8Array(count*n);
  if(samples)for(let i=0;i<samples.length;i++)samples[i]=Math.round(Math.max(0,Math.min(1,output[i]))*255);
  return {mode:target,width:device.width,height:device.height,samples,rgb:target==='rgb'?output:null,alpha:device.alpha,profileName:doc.profileName||null,icc:doc.iccProfile?new Uint8Array(doc.iccProfile):null};
}
function installDeviceCanvas(layer,doc,placed,keepSamples){
  const canvas=document.createElement('canvas');canvas.width=placed.width;canvas.height=placed.height;
  layer.canvas=canvas;layer.x=placed.x||0;layer.y=placed.y||0;layer._devicePaint=null;layer._colorDoc=doc;layer.deviceSamples=placed.samples||null;layer.deviceAlpha=placed.alpha?new Uint8Array(placed.alpha):null;
  if(placed.mode!=='rgb'&&placed.samples){
    const image=canvas.getContext('2d').createImageData(placed.width,placed.height);
    for(let i=0;i<placed.alpha.length;i++)image.data[i*4+3]=placed.alpha[i];
    canvas.getContext('2d').putImageData(image,0,0);
    refreshDevicePreview(doc,layer);
    if(!keepSamples)layer.deviceSamples=null;
    return;
  }
  const image=canvas.getContext('2d').createImageData(placed.width,placed.height);
  for(let i=0,p=0;i<placed.alpha.length;i++,p+=3){image.data[i*4]=Math.round(Math.max(0,Math.min(1,placed.rgb?.[p]||0))*255);image.data[i*4+1]=Math.round(Math.max(0,Math.min(1,placed.rgb?.[p+1]||0))*255);image.data[i*4+2]=Math.round(Math.max(0,Math.min(1,placed.rgb?.[p+2]||0))*255);image.data[i*4+3]=placed.alpha[i];}
  canvas.getContext('2d').putImageData(image,0,0);
}
export function cropLayerNumbers(doc,layer,x,y,width,height,options={}){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas||width<1||height<1)return false;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer),n=channels(mode),sw=layer.canvas.width,sh=layer.canvas.height,ox=Math.round(layer.x||0),oy=Math.round(layer.y||0);
  const nextS=new Uint8Array(width*height*n),nextA=new Uint8Array(width*height);
  if(options.background){const chip=document.createElement('canvas');chip.width=chip.height=1;const paint=chip.getContext('2d');paint.fillStyle=options.background;paint.fillRect(0,0,1,1);const px=paint.getImageData(0,0,1,1).data,solid=new Uint8Array(n);storeRgb(doc,solid,0,n,mode,px,0,null);for(let i=0;i<width*height;i++){nextA[i]=255;for(let c=0;c<n;c++)nextS[i*n+c]=solid[c];}}
  const cover=options.coverage;
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){const sx=px+Math.round(x)-ox,sy=py+Math.round(y)-oy;if(sx<0||sy<0||sx>=sw||sy>=sh)continue;const si=sy*sw+sx,di=py*width+px;let a=alpha[si];if(cover)a=Math.round(a*cover[si]/255);if(options.background){const sa=a/255,da=nextA[di]/255,oa=sa+da*(1-sa);if(oa<=0)continue;for(let c=0;c<n;c++)nextS[di*n+c]=Math.round((samples[si*n+c]*sa+nextS[di*n+c]*da*(1-sa))/oa);nextA[di]=Math.round(oa*255);}else{nextA[di]=a;for(let c=0;c<n;c++)nextS[di*n+c]=samples[si*n+c];}}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;layer.canvas=canvas;layer.deviceSamples=nextS;layer.deviceAlpha=nextA;layer.x=0;layer.y=0;layer._devicePaint=null;presentLayer(doc,layer);return true;
}
export function resizeLayerNumbers(doc,layer,settings){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas)return false;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer);
  const placed=resizeDevice({mode,width:layer.canvas.width,height:layer.canvas.height,samples,alpha,x:layer.x||0,y:layer.y||0},settings||{});
  installDeviceCanvas(layer,doc,placed,true);
  return true;
}
export function perspectiveLayerNumbers(doc,layer,quad,interpolation='bilinear'){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas)return false;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer);
  const placed=warpDeviceRecord({mode,width:layer.canvas.width,height:layer.canvas.height,samples,alpha,x:layer.x||0,y:layer.y||0},quad,interpolation);
  installDeviceCanvas(layer,doc,placed,true);
  return true;
}
export function placePerspectiveSamples(doc,layer,samples,alpha,width,height,quad,interpolation='bilinear'){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!samples||!alpha)return null;
  const placed=warpDeviceRecord({mode,width,height,samples,alpha,x:0,y:0},quad,interpolation);
  installDeviceCanvas(layer,doc,placed,true);
  return placed;
}
export function warpLayerNumbers(doc,layer,operation,originX=0,originY=0){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas)return false;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer);
  const placed=warpPlaceDevice({mode,width:layer.canvas.width,height:layer.canvas.height,samples,alpha,x:0,y:0},operation);
  placed.x+=originX;placed.y+=originY;
  installDeviceCanvas(layer,doc,placed,true);
  return true;
}
export function transformLayerNumbers(doc,layer,settings){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas)return false;
  const samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer);
  const placed=transformDevice({mode,width:layer.canvas.width,height:layer.canvas.height,samples,alpha,x:layer.x||0,y:layer.y||0},settings||{});
  installDeviceCanvas(layer,doc,placed,true);
  return true;
}
export function placeSmartDevice(doc,layer){
  const source=layer?.smartDevice;
  if(!source?.samples||!source.alpha)return false;
  let device=source;
  try{if(source.mode!==(doc.colorMode||'rgb'))device=convertDeviceRecord(source,doc);}catch{return false;}
  const placed={...device,x:layer.smartOrigin?.x||0,y:layer.smartOrigin?.y||0};
  installDeviceCanvas(layer,doc,placed,placed.mode!=='rgb');
  return placed.mode==='rgb'?'preview':'device';
}
export function applySmartDeviceOp(doc,layer,operation){
  if(!layer?.deviceSamples||!doc?.colorMode||doc.colorMode==='rgb')return false;
  const width=layer.canvas?.width,height=layer.canvas?.height,n=modeChannels(doc.colorMode);
  if(!width||!height||layer.deviceSamples.length!==width*height*n)return false;
  const alpha=new Uint8Array(ensureDeviceAlpha(layer));
  const device={mode:doc.colorMode,width,height,samples:layer.deviceSamples,alpha,x:layer.x,y:layer.y};
  let placed;
  if(operation.type==='perspective')placed=warpDeviceRecord(device,operation.quad,operation.interpolation||'bilinear');
  else if(operation.type==='resizePixels')placed=resizeDevice(device,operation.settings||{});
  else if(operation.type==='transform')placed=transformDevice(device,operation.settings||{});
  else if(operation.type==='warpPlace')placed=warpPlaceDevice(device,operation);
  else return false;
  installDeviceCanvas(layer,doc,placed,true);
  return true;
}
export function adoptCmykPlates(doc,layer,plates){
  if(!layer?.canvas||!plates)return;
  const width=layer.canvas.width,height=layer.canvas.height,count=width*height;
  if(plates.length<count*5)return;
  const packed=new Uint8Array(count*4);
  for(let i=0,p=0;i<count;i++,p+=5){packed[i*4]=255-plates[p];packed[i*4+1]=255-plates[p+1];packed[i*4+2]=255-plates[p+2];packed[i*4+3]=255-plates[p+3];}
  const alpha=new Uint8Array(count),image=layer.canvas.getContext('2d').getImageData(0,0,width,height);
  for(let i=0;i<count;i++)alpha[i]=image.data[i*4+3];
  layer.deviceSamples=packed;layer.deviceAlpha=alpha;layer._devicePaint=null;layer._colorDoc=doc;
  refreshDevicePreview(doc,layer);
}
export function adoptStoredSamples(doc,layer){
  const mode=doc?.colorMode;
  if(!layer?.canvas||(mode!=='gray'&&mode!=='lab'))return;
  const image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),count=image.width*image.height,packed=new Uint8Array(count*(mode==='gray'?1:3)),alpha=new Uint8Array(count);
  if(mode==='gray'){for(let i=0;i<count;i++){packed[i]=image.data[i*4];alpha[i]=image.data[i*4+3];}}
  else{for(let i=0;i<count;i++){const o=i*4,s=i*3;packed[s]=image.data[o];packed[s+1]=image.data[o+1];packed[s+2]=image.data[o+2];alpha[i]=image.data[o+3];}}
  layer.deviceSamples=packed;layer.deviceAlpha=alpha;layer._devicePaint=null;layer._colorDoc=doc;
  refreshDevicePreview(doc,layer);
}
export function patternFromComposite(doc,image){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!image)return null;
  const n=channels(mode),count=image.width*image.height,samples=new Uint8Array(count*n),alpha=new Uint8Array(count);
  let opaque=true;
  for(let i=0;i<count;i++){const o=i*4;storeRgb(doc,samples,i*n,n,mode,image.data,o,null);alpha[i]=image.data[o+3];if(alpha[i]!==255)opaque=false;}
  const pixels=[];
  if(opaque){for(let i=0;i<samples.length;i++)pixels.push(samples[i]);return {mode,channels:n,pixels};}
  for(let i=0;i<count;i++){for(let c=0;c<n;c++)pixels.push(samples[i*n+c]);pixels.push(alpha[i]);}
  return {mode,channels:n+1,pixels};
}
export function solidInk(doc,color){
  const mode=doc?.colorMode||'rgb',chip=document.createElement('canvas');chip.width=chip.height=1;const paint=chip.getContext('2d');paint.fillStyle='#000000';paint.fillStyle=color||'#000000';paint.fillRect(0,0,1,1);const px=paint.getImageData(0,0,1,1).data,rgb=[px[0]/255,px[1]/255,px[2]/255];
  if(mode==='gray')return Uint8Array.of(Math.round(rgbToGray(rgb)*255));
  if(mode==='lab'){const lab=srgbToLab(rgb);return Uint8Array.from(lab,v=>Math.round(Math.max(0,Math.min(1,v))*255));}
  if(mode==='cmyk'){const packed=cmykFromRgb(doc,new Float32Array(rgb));return Uint8Array.from(packed,v=>Math.round(Math.max(0,Math.min(1,v))*255));}
  return Uint8Array.of(px[0],px[1],px[2]);
}
export function storeFilteredCanvas(doc,layer){
  if(!doc.colorMode||doc.colorMode==='rgb'||!layer?.canvas)return;
  layer.deviceSamples=null;layer._devicePaint=null;
  ensureDeviceSamples(doc,layer);
  refreshDevicePreview(doc,layer);
}
const previewCache=new Map();
export function effectInkHex(doc,ink){
  if(!doc||!ink||ink.mode!==doc.colorMode||!Array.isArray(ink.values))return null;
  const n=ink.mode==='cmyk'?4:ink.mode==='gray'?1:3;
  if(ink.values.length!==n)return null;
  const values=ink.values.map(value=>Math.max(0,Math.min(255,Math.round(Number(value))))/255);
  let preview;
  if(ink.mode==='gray')preview=new Float32Array([values[0],values[0],values[0]]);
  else if(ink.mode==='lab')preview=Float32Array.from(labToSrgb(values));
  else preview=cmykToRgb(doc,new Float32Array(values));
  return '#'+[0,1,2].map(index=>Math.round(Math.max(0,Math.min(1,preview[index]))*255).toString(16).padStart(2,'0')).join('');
}
export function effectHex(doc,color){
  if(!doc||!doc.colorMode||doc.colorMode==='rgb'||typeof color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(color))return color;
  const key='effect|'+doc.colorMode+'|'+(doc.profileName||'')+'|'+(doc.iccProfile?.byteLength||doc.iccProfile?.length||0)+'|'+color.toLowerCase();
  const cached=previewCache.get(key);if(cached)return cached;
  const rgb=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)/255);
  let preview;
  if(doc.colorMode==='gray'){const g=rgbToGray(rgb);preview=new Float32Array([g,g,g]);}
  else if(doc.colorMode==='lab'){const lab=srgbToLab(rgb);preview=Float32Array.from(labToSrgb([Math.max(0,Math.min(1,lab[0])),Math.max(0,Math.min(1,lab[1])),Math.max(0,Math.min(1,lab[2]))]));}
  else preview=cmykToRgb(doc,cmykFromRgb(doc,new Float32Array(rgb)));
  const hex='#'+[0,1,2].map(index=>Math.round(Math.max(0,Math.min(1,preview[index]))*255).toString(16).padStart(2,'0')).join('');
  previewCache.set(key,hex);return hex;
}
export function previewHex(doc,color){
  if(!doc||!doc.colorMode||doc.colorMode==='rgb'||typeof color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(color))return color;
  const key=doc.colorMode+'|'+(doc.profileName||'')+'|'+(doc.iccProfile?.byteLength||doc.iccProfile?.length||0)+'|'+color.toLowerCase();
  const cached=previewCache.get(key);if(cached)return cached;
  const rgb=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)/255);
  let preview;
  if(doc.colorMode==='gray')preview=convertSamples(grayModel(doc),srgbModel(),new Float32Array([rgbToGray(rgb)]),'relative',true);
  else if(doc.colorMode==='lab'){const lab=srgbToLab(rgb);preview=Float32Array.from(labToSrgb([Math.max(0,Math.min(1,lab[0])),Math.max(0,Math.min(1,lab[1])),Math.max(0,Math.min(1,lab[2]))]));}
  else preview=cmykToRgb(doc,cmykFromRgb(doc,new Float32Array(rgb)));
  const hex='#'+[0,1,2].map(index=>Math.round(Math.max(0,Math.min(1,preview[index]))*255).toString(16).padStart(2,'0')).join('');
  previewCache.set(key,hex);return hex;
}
const U64=(1n<<64n)-1n;
function mix64(z){z=(z+0x9E3779B97F4A7C15n)&U64;z=((z^(z>>30n))*0xBF58476D1CE4E5B9n)&U64;z=((z^(z>>27n))*0x94D049BB133111EBn)&U64;return (z^(z>>31n))&U64;}
function hash2(x,y,salt){const k=(BigInt(x>>>0)<<32n)|BigInt(y>>>0),h=mix64(k^((BigInt(salt)*0xA24BAED4963EE407n)&U64));return Number(h>>40n)/16777216;}
export function paintNativeStroke(doc,layer,bounds,coverage,options={}){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas||!bounds||bounds.w<1||bounds.h<1||!coverage)return;
  const n=channels(mode),samples=ensureDeviceSamples(doc,layer),alpha=ensureDeviceAlpha(layer),width=layer.canvas.width,height=layer.canvas.height;
  const source=options.ink?.mode===mode&&options.ink.values?.length===n?options.ink.values:solidInk(doc,options.color||'#000000');
  const lock=Boolean(options.alphaLock),erase=Boolean(options.erase),dissolve=Boolean(options.dissolve),salt=BigInt(options.seed||0);
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){
    const px=bounds.x+x,py=bounds.y+y;if(px<0||py<0||px>=width||py>=height)continue;
    let k=coverage[(y*bounds.w+x)*4+3]/255;if(options.weight)k*=options.weight(px,py);if(k<=0)continue;
    if(dissolve){k=hash2(px,py,salt)<k?1:0;if(!k)continue;}
    const ai=py*width+px,at=ai*n;
    if(erase){if(!lock)alpha[ai]=Math.round(alpha[ai]*(1-k));continue;}
    if(lock&&alpha[ai]<=0)continue;
    const da=alpha[ai]/255,sa=k,oa=sa+da*(1-sa);
    if(oa>0)for(let c=0;c<n;c++)samples[at+c]=Math.round((source[c]/255*sa+samples[at+c]/255*da*(1-sa))/oa*255);
    if(!lock)alpha[ai]=Math.round(Math.max(0,Math.min(1,oa))*255);
  }
  presentLayer(doc,layer);
}
export function strokeBounds(from,to,width,canvas){
  const radius=width/2+3,x0=Math.max(0,Math.floor(Math.min(from.x,to.x)-radius)),y0=Math.max(0,Math.floor(Math.min(from.y,to.y)-radius)),x1=Math.min(canvas.width,Math.ceil(Math.max(from.x,to.x)+radius)),y1=Math.min(canvas.height,Math.ceil(Math.max(from.y,to.y)+radius));
  return {x:x0,y:y0,w:Math.max(0,x1-x0),h:Math.max(0,y1-y0)};
}
function pixelChanged(before,after,i){return before.data[i]!==after.data[i]||before.data[i+1]!==after.data[i+1]||before.data[i+2]!==after.data[i+2]||before.data[i+3]!==after.data[i+3];}
export function readDeviceInk(doc,layer,x,y,size){
  const mode=doc?.colorMode||'rgb';
  if(mode==='rgb'||!layer?.canvas||!layer.deviceSamples)return null;
  const n=channels(mode),width=layer.canvas.width,height=layer.canvas.height;
  if(layer.deviceSamples.length!==width*height*n)return null;
  const span=eyedropperSizes.includes(size)?size:1,radius=span>>1,x0=Math.floor(x)-radius,y0=Math.floor(y)-radius,sum=new Float64Array(n);
  let count=0;
  for(let yy=0;yy<span;yy++)for(let xx=0;xx<span;xx++){const px=x0+xx,py=y0+yy;if(px<0||py<0||px>=width||py>=height)continue;const at=(py*width+px)*n;for(let c=0;c<n;c++)sum[c]+=layer.deviceSamples[at+c];count++;}
  if(!count)return null;
  return {mode,values:Array.from(sum,value=>Math.round(value/count))};
}
export function inkPreviewHex(doc,ink){
  const values=ink.values;let preview;
  if(ink.mode==='gray')preview=convertSamples(grayModel(doc),srgbModel(),new Float32Array([values[0]/255]),'relative',true);
  else if(ink.mode==='lab')preview=Float32Array.from(labToSrgb(values.map(value=>value/255)));
  else preview=cmykToRgb(doc,Float32Array.from(values,value=>value/255));
  return '#'+[0,1,2].map(index=>Math.round(Math.max(0,Math.min(1,preview[index]))*255).toString(16).padStart(2,'0')).join('');
}
export function commitBrushDevice(doc,layer,work,bounds,before,ink){
  const mode=doc.colorMode||'rgb';
  if(mode==='rgb'||bounds.w<1||bounds.h<1)return;
  ensureDeviceSamples(doc,layer);
  const after=work.getContext('2d').getImageData(bounds.x,bounds.y,bounds.w,bounds.h);
  const index=[];
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const i=(y*bounds.w+x)*4;if(before&&!pixelChanged(before,after,i))continue;index.push((bounds.y+y)*layer.canvas.width+(bounds.x+x));}
  if(!index.length)return;
  const packed=new Float32Array(index.length*3);
  let cursor=0;
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const i=(y*bounds.w+x)*4;if(before&&!pixelChanged(before,after,i))continue;packed[cursor++]=after.data[i]/255;packed[cursor++]=after.data[i+1]/255;packed[cursor++]=after.data[i+2]/255;}
  const n=channels(mode),samples=layer.deviceSamples;
  let device;
  if(mode==='gray'){device=new Float32Array(index.length);for(let i=0;i<index.length;i++)device[i]=rgbToGray([packed[i*3],packed[i*3+1],packed[i*3+2]]);}
  else if(mode==='lab'){device=new Float32Array(index.length*3);for(let i=0;i<index.length;i++){const lab=srgbToLab([packed[i*3],packed[i*3+1],packed[i*3+2]]);device[i*3]=Math.max(0,Math.min(1,lab[0]));device[i*3+1]=Math.max(0,Math.min(1,lab[1]));device[i*3+2]=Math.max(0,Math.min(1,lab[2]));}}
  else device=cmykFromRgb(doc,packed);
  if(ink?.mode===mode&&ink.values?.length===n&&ink.rgb){let k=0;for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const i=(y*bounds.w+x)*4;if(before&&!pixelChanged(before,after,i))continue;if(after.data[i+3]===255&&after.data[i]===ink.rgb[0]&&after.data[i+1]===ink.rgb[1]&&after.data[i+2]===ink.rgb[2])for(let c=0;c<n;c++)device[k*n+c]=ink.values[c]/255;k++;}}
  for(let i=0;i<index.length;i++){const at=index[i]*n;for(let c=0;c<n;c++)samples[at+c]=Math.round(Math.max(0,Math.min(1,device[i*n+c]))*255);}
  let preview;
  if(mode==='gray')preview=convertSamples(grayModel(doc),srgbModel(),device,'relative',true);
  else if(mode==='lab'){preview=new Float32Array(index.length*3);for(let i=0;i<index.length;i++){const rgb=labToSrgb([device[i*3],device[i*3+1],device[i*3+2]]);preview[i*3]=rgb[0];preview[i*3+1]=rgb[1];preview[i*3+2]=rgb[2];}}
  else preview=cmykToRgb(doc,device);
  const shown=layer.canvas.getContext('2d').getImageData(bounds.x,bounds.y,bounds.w,bounds.h);
  let k=0;
  for(let y=0;y<bounds.h;y++)for(let x=0;x<bounds.w;x++){const i=(y*bounds.w+x)*4;if(before&&!pixelChanged(before,after,i))continue;shown.data[i]=Math.round(Math.max(0,Math.min(1,preview[k*3]))*255);shown.data[i+1]=Math.round(Math.max(0,Math.min(1,preview[k*3+1]))*255);shown.data[i+2]=Math.round(Math.max(0,Math.min(1,preview[k*3+2]))*255);shown.data[i+3]=after.data[i+3];k++;}
  layer.canvas.getContext('2d').putImageData(shown,bounds.x,bounds.y);
}
