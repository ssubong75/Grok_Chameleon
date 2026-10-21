// PhotoCraft Transform::new / convert_document for the Edit colour commands.
// Device values are 0..1. Non-RGB layers keep those numbers; the canvas is only the preview.
import {evalLut,readIccModel} from './icc-lut.js';
import {cachedProfile,documentProfile,linearGrayProfile,modeOfProfile,profileById,resolveProfile,spaceName,workingProfileId} from './cms-profiles.js';
import {exifColorSpace} from './jpeg-exif.js';

const D50=[0.9642,1,0.8249];
const PERCEPTUAL_Y=0.0034731;

function lutFor(luts,intent){const index=intent==='perceptual'?0:intent==='saturation'?2:1;return luts?.[index]||luts?.[0]||null;}
function columnsMatrix(columns){return [0,1,2].flatMap(row=>[0,1,2].map(col=>columns[col][row]));}
function invert3(m){
  const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(det)<1e-12)throw Error('The colour matrix cannot be inverted.');
  const s=1/det;
  return [[(e*i-f*h)*s,(c*h-b*i)*s,(b*f-c*e)*s],[(f*g-d*i)*s,(a*i-c*g)*s,(c*d-a*f)*s],[(d*h-e*g)*s,(b*g-a*h)*s,(a*e-b*d)*s]];
}
function deviceStages(model,intent){
  const lut=lutFor(model.a2b,intent);
  if(lut){const decode=model.pcs==='xyz'?'decode-xyz':lut.kind==='lut16'?'decode-lab-v2':'decode-lab-v4';return {pcs:model.pcs,stages:[...lut.stages,{pcs:decode}]};}
  if(model.space==='RGB '&&model.columns&&model.curves)return {pcs:'xyz',stages:[{curves:model.curves},{matrix:columnsMatrix(model.columns),offset:[0,0,0]}]};
  if(model.space==='GRAY'&&model.gray)return {pcs:'xyz',stages:[{curves:[model.gray]},{matrix:D50.slice(),offset:[0,0,0]}]};
  if(model.space==='Lab ')return {pcs:'lab',stages:[{pcs:'decode-lab-v4'}]};
  throw Error(model.description||model.space+' has no device-to-PCS table for '+intent+'.');
}
function pcsStages(model,intent){
  const lut=lutFor(model.b2a,intent);
  if(lut){const encode=model.pcs==='xyz'?'encode-xyz':lut.kind==='lut16'?'encode-lab-v2':'encode-lab-v4';return {pcs:model.pcs,stages:[{pcs:encode},...lut.stages]};}
  if(model.space==='RGB '&&model.columns&&model.invCurves){
    const forward=[[model.columns[0][0],model.columns[1][0],model.columns[2][0]],[model.columns[0][1],model.columns[1][1],model.columns[2][1]],[model.columns[0][2],model.columns[1][2],model.columns[2][2]]];
    const inverse=invert3(forward);
    return {pcs:'xyz',stages:[{matrix:inverse.flat(),offset:[0,0,0]},{curves:model.invCurves}]};
  }
  if(model.space==='GRAY'&&model.grayInv)return {pcs:'xyz',stages:[{matrix:[0,1,0],offset:[0]},{curves:[model.grayInv]}]};
  if(model.space==='Lab ')return {pcs:'lab',stages:[{pcs:'encode-lab-v4'}]};
  throw Error(model.description||model.space+' cannot be a destination for '+intent+'.');
}
function yOf(pcs,value){if(pcs!=='lab')return value[1]||0;const xyz=evalLut({stages:[{pcs:'lab-xyz'}]},value);return xyz[1]||0;}
function blackPoint(model,intent){
  if(model.space==='Lab '||model.space==='XYZ ')return 0;
  const lutBased=model.a2b?.some(Boolean);
  if(lutBased&&model.version>=4&&(intent==='perceptual'||intent==='saturation'))return PERCEPTUAL_Y;
  const to=deviceStages(model,intent);
  const measure=dev=>Math.max(0,Math.min(.5,yOf(to.pcs,evalLut(to,dev))));
  if(model.space==='RGB '||model.space==='GRAY'||!lutBased)return measure(Array(model.channels).fill(0));
  try{
    const from=pcsStages(model,intent==='saturation'?'saturation':'relative');
    const stages=from.pcs==='xyz'?[{pcs:'lab-xyz'},...from.stages]:from.stages;
    const dev=evalLut({stages},[0,0,0]).slice(0,model.channels);
    return measure(dev);
  }catch{return measure(Array(model.channels).fill(1));}
}
function connection(src,dst,intent,bpc){
  if(intent==='absolute'){
    if(!src.white.every(v=>v>0)||!dst.white.every(v=>v>0))throw Error('Absolute colorimetric needs a positive media white point.');
    const scale=src.white.map((value,index)=>value/dst.white[index]);
    return scale.every(value=>Math.abs(value-1)<1e-6)?null:{scale,offset:[0,0,0]};
  }
  if(!bpc)return null;
  const bs=blackPoint(src,intent),bd=blackPoint(dst,intent);
  if(Math.abs(bs-bd)<1e-6)return null;
  const scale=[1,1,1],offset=[0,0,0];
  for(let i=0;i<3;i++){const s=bs*D50[i],d=bd*D50[i],a=(D50[i]-d)/(D50[i]-s);scale[i]=a;offset[i]=D50[i]*(1-a);}
  return {scale,offset};
}
export function linkStages(src,dst,intent,bpc){
  const from=deviceStages(src,intent),to=pcsStages(dst,intent),stages=[...from.stages],adjust=connection(src,dst,intent,bpc!==false);
  if(adjust){
    if(from.pcs==='lab')stages.push({pcs:'lab-xyz'});
    stages.push({matrix:[adjust.scale[0],0,0,0,adjust.scale[1],0,0,0,adjust.scale[2]],offset:adjust.offset});
    if(to.pcs==='lab')stages.push({pcs:'xyz-lab'});
  }else if(from.pcs==='lab'&&to.pcs==='xyz')stages.push({pcs:'lab-xyz'});
  else if(from.pcs==='xyz'&&to.pcs==='lab')stages.push({pcs:'xyz-lab'});
  stages.push(...to.stages);
  return stages;
}
export function convertSamples(src,dst,samples,intent='relative',bpc=true){
  const stages=linkStages(src,dst,intent,bpc),inn=src.channels,out=dst.channels,result=new Float32Array(samples.length/inn*out),input=new Array(inn);
  for(let i=0,j=0;i<samples.length;i+=inn,j+=out){for(let c=0;c<inn;c++)input[c]=samples[i+c];const value=evalLut({stages},input);for(let c=0;c<out;c++)result[j+c]=Math.max(0,Math.min(1,value[c]||0));}
  return result;
}

function modeChannels(mode){return mode==='cmyk'?4:mode==='gray'?1:3;}
function readDevice(doc,layer,image){
  const mode=doc.colorMode||'rgb',count=image.width*image.height,channels=modeChannels(mode),samples=new Float32Array(count*channels);
  if(mode==='rgb'){for(let i=0,p=0;i<image.data.length;i+=4,p+=3){samples[p]=image.data[i]/255;samples[p+1]=image.data[i+1]/255;samples[p+2]=image.data[i+2]/255;}}
  else{
    const packed=layer.deviceSamples;
    if(!packed||packed.length!==count*channels)throw Error('The layer has no '+mode+' samples.');
    for(let i=0;i<packed.length;i++)samples[i]=packed[i]/255;
  }
  return samples;
}
function writeDevice(layer,image,mode,samples){
  const count=image.width*image.height,channels=modeChannels(mode);
  if(mode==='rgb'){layer.deviceSamples=null;for(let i=0,p=0;i<image.data.length;i+=4,p+=3){image.data[i]=Math.round(samples[p]*255);image.data[i+1]=Math.round(samples[p+1]*255);image.data[i+2]=Math.round(samples[p+2]*255);}}
  else{
    const packed=new Uint8Array(count*channels);
    for(let i=0;i<packed.length;i++)packed[i]=Math.round(Math.max(0,Math.min(1,samples[i]))*255);
    layer.deviceSamples=packed;
  }
}
function inkBytes(values){return Array.from(values,value=>Math.max(0,Math.min(255,Math.round(Number(value)||0))));}
function convertStoredInk(ink,fromMode,src,dst,intent,bpc){if(!ink||ink.mode!==fromMode||!Array.isArray(ink.values))return null;const samples=Float32Array.from(ink.values,value=>Math.max(0,Math.min(255,Number(value)||0))/255),out=convertSamples(src,dst,samples,intent,bpc);return {mode:modeOfProfile(dst),values:inkBytes(Float32Array.from(out,value=>value*255)),hex:ink.hex};}
function convertInkTree(node,fromMode,src,dst,intent,bpc,pending){if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key.endsWith('Ink')&&value&&typeof value==='object'){const next=convertStoredInk(value,fromMode,src,dst,intent,bpc);if(next)pending.push([node,key,next]);}else if(key==='stopsInk'&&Array.isArray(value)){value.forEach((ink,index)=>{const next=convertStoredInk(ink,fromMode,src,dst,intent,bpc);if(next)pending.push([value,index,next]);});}else if(value&&typeof value==='object')convertInkTree(value,fromMode,src,dst,intent,bpc,pending);}}
function recolorDuotoneNode(node,render,duotone){if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){const paint=ink=>{if(ink?.mode!=='gray'||!ink.values?.length)return;const rgb=render(duotone,Math.max(0,Math.min(255,Number(ink.values[0])||0))/255);ink.mode='rgb';ink.values=rgb.map(channel=>Math.round(Math.max(0,Math.min(1,channel))*255));};if(key.endsWith('Ink'))paint(value);else if(key==='stopsInk'&&Array.isArray(value))value.forEach(paint);else if(value&&typeof value==='object')recolorDuotoneNode(value,render,duotone);}}
function hexSamples(hex){const n=Number.parseInt(hex.slice(1),16);return new Float32Array([(n>>16)/255,((n>>8)&255)/255,(n&255)/255]);}
function rgbHex(samples){const byte=i=>Math.max(0,Math.min(255,Math.round((samples[i]||0)*255))).toString(16).padStart(2,'0');return '#'+byte(0)+byte(1)+byte(2);}
function documentSamples(hex,fromMode,src,srgbToLab){const rgb=hexSamples(hex);if(fromMode==='rgb')return rgb;if(fromMode==='gray')return new Float32Array([0.299*rgb[0]+0.587*rgb[1]+0.114*rgb[2]]);if(fromMode==='lab')return Float32Array.from(srgbToLab([rgb[0],rgb[1],rgb[2]]));return convertSamples(cachedProfile('srgb'),src,rgb,'relative',true);}
function convertRgbHex(hex,src,dst,intent,bpc,fromMode,srgbToLab){const out=convertSamples(src,dst,documentSamples(hex,fromMode,src,srgbToLab),intent,bpc),mode=modeOfProfile(dst);if(mode==='rgb')return {hex:rgbHex(out)};const values=inkBytes(Float32Array.from(out,value=>value*255));return {ink:{mode,values,hex}};}
function convertRgbColors(node,src,dst,intent,bpc,fromMode,srgbToLab,edits){if(!node||typeof node!=='object')return;const convert=hex=>convertRgbHex(hex,src,dst,intent,bpc,fromMode,srgbToLab);for(const [key,value] of Object.entries(node)){if(key.endsWith('Ink')||key==='stopsInk')continue;if(typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)&&/color|fill|stroke/i.test(key)&&!node[key+'Ink'])edits.push([node,key,convert(value)]);else if(key==='stops'&&typeof value==='string'&&!node.stopsInk){const parts=[...value.matchAll(/#[0-9a-fA-F]{6}/g)].map(match=>convert(match[0]));if(parts.some(part=>part.ink))edits.push([node,'stops',{stops:value,parts}]);else edits.push([node,key,value.replace(/#[0-9a-fA-F]{6}/g,hex=>convert(hex).hex)]);}else if(key==='stops'&&Array.isArray(value)){for(const stop of value)if(Array.isArray(stop?.[1])&&stop[1].length>=3){const out=convertSamples(src,dst,documentSamples('#'+[0,1,2].map(i=>Math.round(Math.max(0,Math.min(1,stop[1][i]))*255).toString(16).padStart(2,'0')).join(''),fromMode,src,srgbToLab),intent,bpc),destMode=modeOfProfile(dst);if(destMode==='rgb'){stop[1][0]=out[0];stop[1][1]=out[1];stop[1][2]=out[2];}else edits.push([stop,1,{ink:{mode:destMode,values:inkBytes(Float32Array.from(out,channel=>channel*255)),hex:''},alpha:stop[1][3]??1}]);}}else if(value&&typeof value==='object'&&!Array.isArray(value))convertRgbColors(value,src,dst,intent,bpc,fromMode,srgbToLab,edits);}}
function convertSmartCache(layer,src,dst,fromMode,intent,bpc){const dest=modeOfProfile(dst),device=layer.smartDevice;if(device?.mode===fromMode&&fromMode!=='rgb'&&device.samples){const out=convertSamples(src,dst,Float32Array.from(device.samples,value=>value/255),intent,bpc);if(dest==='rgb'){if(layer.smartSource&&layer.smartSource.width===device.width&&layer.smartSource.height===device.height){const context=layer.smartSource.getContext('2d'),image=context.getImageData(0,0,device.width,device.height);for(let i=0,p=0;i<image.data.length;i+=4,p+=3){image.data[i]=Math.round(out[p]*255);image.data[i+1]=Math.round(out[p+1]*255);image.data[i+2]=Math.round(out[p+2]*255);image.data[i+3]=device.alpha?.[i]??image.data[i+3];}context.putImageData(image,0,0);}layer.smartDevice=null;return;}device.mode=dest;device.samples=Uint8Array.from(out,value=>Math.round(Math.max(0,Math.min(1,value))*255));device.profileName=dst.id||null;device.icc=dst.bytes?new Uint8Array(dst.bytes):null;return;}if(fromMode==='rgb'&&layer.smartSource){const canvas=layer.smartSource,context=canvas.getContext('2d'),image=context.getImageData(0,0,canvas.width,canvas.height),samples=new Float32Array(canvas.width*canvas.height*3);for(let i=0,p=0;i<image.data.length;i+=4,p+=3){samples[p]=image.data[i]/255;samples[p+1]=image.data[i+1]/255;samples[p+2]=image.data[i+2]/255;}const out=convertSamples(src,dst,samples,intent,bpc);if(dest==='rgb'){for(let i=0,p=0;i<image.data.length;i+=4,p+=3){image.data[i]=Math.round(out[p]*255);image.data[i+1]=Math.round(out[p+1]*255);image.data[i+2]=Math.round(out[p+2]*255);}context.putImageData(image,0,0);return;}const alpha=new Uint8Array(canvas.width*canvas.height);for(let i=0;i<alpha.length;i++)alpha[i]=image.data[i*4+3];layer.smartDevice={mode:dest,width:canvas.width,height:canvas.height,samples:Uint8Array.from(out,value=>Math.round(Math.max(0,Math.min(1,value))*255)),alpha,profileName:dst.id||null,icc:dst.bytes?new Uint8Array(dst.bytes):null};}}
export async function convertDocumentToProfile(doc,dst,intent,bpc,settings){
  const {renderDuotone}=await import('./duotone.js'),{srgbToLab}=await import('./device-paint.js');
  if(modeOfProfile(dst)!=='gray'&&doc.duotone?.inks?.length&&(doc.psdMode==='duotone'||doc.colorMode==='gray')){for(const layer of doc.layers){if(!layer.deviceSamples||!layer.canvas)continue;const count=layer.canvas.width*layer.canvas.height;if(layer.deviceSamples.length!==count)continue;const image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height);for(let i=0;i<count;i++){const rgb=renderDuotone(doc.duotone,layer.deviceSamples[i]/255),o=i*4;image.data[o]=Math.round(rgb[0]*255);image.data[o+1]=Math.round(rgb[1]*255);image.data[o+2]=Math.round(rgb[2]*255);image.data[o+3]=layer.deviceAlpha?.[i]??image.data[o+3];}layer.canvas.getContext('2d').putImageData(image,0,0);layer.deviceSamples=null;layer.deviceAlpha=null;}for(const layer of doc.layers){if(layer.text)recolorDuotoneNode(layer.text,renderDuotone,doc.duotone);if(layer.shape)recolorDuotoneNode(layer.shape,renderDuotone,doc.duotone);if(layer.effects)recolorDuotoneNode(layer.effects,renderDuotone,doc.duotone);}doc.colorMode='rgb';doc.profileName='srgb';doc.iccProfile=null;doc.psdMode=null;doc.duotone=null;}
  const src=await documentProfile(doc,settings),mode=modeOfProfile(dst),fromMode=doc.colorMode||'rgb';
  const pending=[];
  for(const layer of doc.layers){
    if(!layer.canvas||layer.kind==='group'||layer.kind==='adjustment')continue;
    const context=layer.canvas.getContext('2d'),image=context.getImageData(0,0,layer.canvas.width,layer.canvas.height);
    const samples=readDevice(doc,layer,image),converted=convertSamples(src,dst,samples,intent,bpc);
    pending.push({layer,context,image,converted,mode});
  }
  doc.colorMode=mode;doc.profileName=dst.id||null;doc.iccProfile=dst.bytes?new Uint8Array(dst.bytes):null;doc.psdMode=null;doc.duotoneRaw=null;doc.colorTable=null;
  for(const item of pending){writeDevice(item.layer,item.image,item.mode,item.converted);item.layer._devicePaint=null;if(item.mode==='rgb'){item.layer.deviceAlpha=null;item.context.putImageData(item.image,0,0);}}
  const inkEdits=[],colorEdits=[];
  for(const layer of doc.layers){convertSmartCache(layer,src,dst,fromMode,intent,bpc);if(layer.text)convertRgbColors(layer.text,src,dst,intent,bpc,fromMode,srgbToLab,colorEdits);if(layer.shape)convertRgbColors(layer.shape,src,dst,intent,bpc,fromMode,srgbToLab,colorEdits);if(layer.effects)convertRgbColors(layer.effects,src,dst,intent,bpc,fromMode,srgbToLab,colorEdits);if(layer.fill)convertRgbColors(layer.fill,src,dst,intent,bpc,fromMode,srgbToLab,colorEdits);if(layer.text)convertInkTree(layer.text,fromMode,src,dst,intent,bpc,inkEdits);if(layer.shape)convertInkTree(layer.shape,fromMode,src,dst,intent,bpc,inkEdits);if(layer.effects)convertInkTree(layer.effects,fromMode,src,dst,intent,bpc,inkEdits);if(layer.fill)convertInkTree(layer.fill,fromMode,src,dst,intent,bpc,inkEdits);}
  if(inkEdits.length||colorEdits.length){const {effectInkHex}=await import('./device-paint.js');for(const [node,key,ink] of inkEdits){ink.hex=effectInkHex(doc,ink)||ink.hex;node[key]=ink;const colorKey=typeof key==='string'&&key.endsWith('Ink')?key.slice(0,-3):null;if(colorKey&&typeof node[colorKey]==='string')node[colorKey]=ink.hex;}for(const [node,key,value] of colorEdits){if(key===1&&Array.isArray(node)&&value?.ink){value.ink.hex=effectInkHex(doc,value.ink)||'#000000';const n=Number.parseInt(value.ink.hex.slice(1),16);node[1]=[(n>>16)/255,((n>>8)&255)/255,(n&255)/255,value.alpha??1];}else if(value?.parts){node.stopsInk=value.parts.map(part=>part.ink?{...part.ink,hex:effectInkHex(doc,part.ink)||part.hex}:null);let index=0;node.stops=value.stops.replace(/#[0-9a-fA-F]{6}/g,()=>{const part=value.parts[index++];return part.ink?effectInkHex(doc,part.ink)||part.hex:part.hex;});}else if(value?.ink){value.ink.hex=effectInkHex(doc,value.ink)||value.hex;node[key+'Ink']=value.ink;if(typeof node[key]==='string')node[key]=value.ink.hex;}else if(typeof value?.hex==='string')node[key]=value.hex;else if(typeof value==='string')node[key]=value;}}
  if(mode!=='rgb'&&pending.length){const {presentLayer}=await import('./device-paint.js');for(const item of pending)presentLayer(doc,item.layer);}
}
function bytesEqual(a,b){if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
export function canBeDestination(model){for(const intent of ['perceptual','relative','saturation']){try{pcsStages(model,intent);}catch{return false;}}return true;}
export async function sameColors(a,b){if(bytesEqual(a?.bytes,b?.bytes))return true;const n=a?.channels||0;if(!a||!b||a.space!==b.space||n<1||n>4)return false;const lab=await profileById('lab-d50'),steps=n<=3?17:9,total=steps**n,input=new Float32Array(n);for(let i=0;i<total;i++){let k=i;for(let c=0;c<n;c++){input[c]=(k%steps)/(steps-1);k=Math.floor(k/steps);}let left,right;try{left=convertSamples(a,lab,input,'relative',false);right=convertSamples(b,lab,input,'relative',false);}catch{return false;}const d=[left[0]*100-(right[0]*100),left[1]*255-128-(right[1]*255-128),left[2]*255-128-(right[2]*255-128)];if(Math.hypot(d[0],d[1],d[2])>0.5)return false;}return true;}
export function profilesMatch(a,b){return a.id&&a.id===b.id||a.description&&a.description===b.description;}
export async function planOpenColor(doc,settings,ignoreExif=false){
  const mode=doc.colorMode||'rgb';
  if(!['rgb','cmyk','gray'].includes(mode))return {action:'kept'};
  const exifSrgb=mode==='rgb'&&!ignoreExif&&!doc.iccProfile&&exifColorSpace(doc.exif)===1;
  if(exifSrgb){const srgb=await profileById('srgb');doc.iccProfile=srgb.bytes?new Uint8Array(srgb.bytes):null;doc.profileName=srgb.id;}
  const working=await profileById(workingProfileId(settings,mode));
  const policy=settings['policy'+(mode==='cmyk'?'Cmyk':mode==='gray'?'Gray':'Rgb')];
  let embedded=null;
  if(doc.iccProfile){try{embedded=readIccModel(doc.iccProfile);}catch{embedded=null;}}
  const hasEmbedded=Boolean(embedded)&&spaceName(embedded.space)===mode;
  const report=value=>exifSrgb?{...value,exif:true}:value;
  if(!hasEmbedded){
    const fallback=await profileById(workingProfileId({workingRgb:'srgb',workingGray:'dot-gain-20-compat',workingCmyk:'coated-cmyk'},mode));
    const assign=policy!=='off'&&!bytesEqual(working.bytes,fallback.bytes);
    return report({action:assign?'assigned':'untagged',working:working.description,policy,missing:true,ask:Boolean(settings.askOnMissing),assign});
  }
  const mismatch=!await sameColors(embedded,working);
  const linear=doc.depth==='f32'&&(await sameColors(embedded,await profileById('linear-srgb'))||await sameColors(embedded,linearGrayProfile()));
  if(!mismatch||linear)return report({action:'kept',embedded:embedded.description,working:working.description,mismatch,policy});
  const inputOnly=!canBeDestination(embedded);
  const action=policy==='off'?'discarded':policy==='preserve'&&!inputOnly?'kept':'converted';
  return report({action,embedded:embedded.description,working:working.description,mismatch:true,policy,ask:Boolean(settings.askOnMismatch),inputOnly});
}
export async function applyOpenColor(doc,settings,action){
  const mode=doc.colorMode||'rgb',working=await profileById(workingProfileId(settings,mode));
  if(action==='discard'||action==='discarded'){doc.iccProfile=null;doc.profileName=null;return {action:'discarded'};}
  if(action==='assign'||action==='assigned'||action==='assignWorking'){doc.iccProfile=working.bytes?new Uint8Array(working.bytes):null;doc.profileName=working.id;return {action:'assigned',profile:working.description};}
  if(action==='convert'||action==='converted'){try{await convertDocumentToProfile(doc,working,settings.intent||'relative',settings.bpc!==false,settings);return {action:'converted',profile:working.description};}catch{return {action:'kept'};}}
  return {action:'kept'};
}
export async function settleOpenColor(doc,settings,hooks){
  const report=await planOpenColor(doc,settings,Boolean(hooks.ignoreExif));
  const apply=async action=>{const result=await applyOpenColor(doc,settings,action);hooks.render?.();return result;};
  if(report.ask&&hooks.showDialog){
    const choice=report.missing?'preserve':report.policy==='off'?'discard':report.policy==='convert'?'convert':'preserve';
    hooks.showDialog(report.missing?'Missing Profile':'Embedded Profile Mismatch',[
      {text:report.missing?'This document has no profile. The working space is '+report.working+'.':report.embedded+' does not match the working space '+report.working+'.'},
      {key:'action',label:'Action',value:choice,options:report.missing?[['preserve','Leave untagged'],['assignWorking','Assign working space']]:[['preserve','Use the embedded profile'],['convert','Convert to working space'],['discard','Discard the profile']]}
    ]).then(async values=>{if(!values||hooks.closed?.())return;try{await apply(values.action);}catch(error){hooks.message?.(error.message);}}).catch(error=>hooks.message?.(error.message));
    return report;
  }
  if(report.action==='assigned'&&report.assign)await apply('assigned');
  else if(report.action==='converted'||report.action==='discarded')await apply(report.action);
  return report;
}
