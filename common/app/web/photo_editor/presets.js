// PhotoCraft preset libraries and Edit › Color Settings.

import {readPat,writePat} from './pat.js';
import {deviceImageData,mergeGrayDocument,patternFromComposite} from './device-paint.js';
import {canonicalProfileId,isIccPath,profileSpace} from './cms-profiles.js';
const KEY='chameleon.photoEditor.libraries';
const BRUSH_KEY='chameleon.photoEditor.brushPresets';
const COLOR_KEY='chameleon.photoEditor.colorSettings';
const INTENTS=new Set(['relative','perceptual','saturation','absolute']);
const POLICIES=new Set(['preserve','convert','off']);

export function defaultColorSettings(){
  return {workingRgb:'srgb',workingCmyk:'coated-cmyk',workingGray:'dot-gain-20-compat',policyRgb:'preserve',policyCmyk:'preserve',policyGray:'preserve',askOnMismatch:true,askOnPaste:true,askOnMissing:false,intent:'relative',bpc:true,dither:true,blendTextGamma:1.45,monitorProfile:'auto'};
}

export function readColorSettings(state){
  const base=defaultColorSettings();
  let saved=state?.colorSettings;
  if(!saved){try{saved=JSON.parse(localStorage.getItem(COLOR_KEY)||'null');}catch{saved=null;}}
  if(saved&&typeof saved==='object'){
    if(saved.working&&!saved.workingRgb)saved.workingRgb=saved.working;
    if(saved.policy&&!saved.policyRgb)saved.policyRgb=saved.policy;
    Object.assign(base,saved);
  }
  const kept=value=>isIccPath(value)?String(value).trim():canonicalProfileId(value)||value;
  base.workingRgb=kept(base.workingRgb);
  base.workingCmyk=kept(base.workingCmyk);
  base.workingGray=kept(base.workingGray);
  if(base.monitorProfile!=='auto')base.monitorProfile=kept(base.monitorProfile);
  base.working=base.workingRgb;base.policy=base.policyRgb;
  if(state)state.colorSettings=base;
  return base;
}

function storedId(value){const text=String(value||'').trim();return isIccPath(text)?text:canonicalProfileId(text);}
export function validateColorSettings(next){
  const rgb=storedId(next.workingRgb),cmyk=storedId(next.workingCmyk),gray=storedId(next.workingGray);
  if(!isIccPath(rgb)&&profileSpace(rgb)!=='rgb')throw Error('working space `'+next.workingRgb+'` is not an RGB profile');
  if(!isIccPath(cmyk)&&profileSpace(cmyk)!=='cmyk')throw Error('working space `'+next.workingCmyk+'` is not a CMYK profile');
  if(!isIccPath(gray)&&profileSpace(gray)!=='gray')throw Error('working space `'+next.workingGray+'` is not a gray profile');
  next.workingRgb=rgb;next.workingCmyk=cmyk;next.workingGray=gray;
  if(!INTENTS.has(next.intent))throw Error('unknown intent `'+next.intent+'` (perceptual|relative|saturation|absolute)');
  for(const key of ['policyRgb','policyCmyk','policyGray'])if(!POLICIES.has(next[key]))throw Error('`'+key+'` must be preserve|convert|off');
  if(next.monitorProfile!=='auto'){const monitor=storedId(next.monitorProfile);if(!isIccPath(monitor)&&profileSpace(monitor)!=='rgb')throw Error('monitor profile `'+next.monitorProfile+'` is not RGB');next.monitorProfile=monitor;}
  if(!(next.blendTextGamma>=1&&next.blendTextGamma<=2.2))throw Error('`blendTextGamma` must be 1.0..2.2');
}

export function saveColorSettings(state,next){
  validateColorSettings(next);
  next.working=next.workingRgb;next.policy=next.policyRgb;
  state.colorSettings=next;
  localStorage.setItem(COLOR_KEY,JSON.stringify(next));
  return next;
}

function emptyLibraries(){return {brushes:[],patterns:[],customShapes:[],gradients:[],styles:[],shapes:[],patternGroups:[],toolPresets:[]};}

export function libraries(){
  try{const data=JSON.parse(localStorage.getItem(KEY)||'null');if(data&&typeof data==='object')return {...emptyLibraries(),...data,brushes:data.brushes||[],patterns:data.patterns||[],customShapes:data.customShapes||data.shapes||[],gradients:data.gradients||[],styles:data.styles||[],shapes:data.shapes||[],patternGroups:data.patternGroups||[],toolPresets:data.toolPresets||[]};}catch{}
  return emptyLibraries();
}

function save(data){localStorage.setItem(KEY,JSON.stringify(data));const tips=data.brushes.filter(b=>!b.builtin).map(b=>({name:b.name,size:b.size,hardness:100,opacity:100,brush:{shape:'sampled',spacing:b.spacing??.25,flow:1},tip:b.tip}));localStorage.setItem(BRUSH_KEY,JSON.stringify(tips));}

export function presetNames(kind){
  const data=libraries();
  if(kind==='brushes')return data.brushes.map(b=>b.name);
  if(kind==='customShapes')return data.customShapes.map(s=>s.name);
  if(kind==='patterns')return data.patterns.map(p=>p.name);
  return null;
}

function indexOf(kind,query){
  const names=presetNames(kind);
  if(!names)throw Error('unknown preset kind `'+kind+'` (brushes|customShapes|patterns)');
  if(Number.isInteger(query.index)&&query.index>=0&&query.index<names.length)return query.index;
  if(!query.name)throw Error('give `index` or `name`');
  const i=names.indexOf(query.name);
  if(i<0)throw Error('no preset named `'+query.name+'`');
  return i;
}

function moveItem(list,from,to){
  if(to>list.length)to=list.length;
  const [item]=list.splice(from,1);
  list.splice(to>from?to-1:to,0,item);
}

export function managePresets(action,kind,query={}){
  if(action==='list'){
    const kinds=kind?[kind]:['brushes','customShapes','patterns'];
    const out={};for(const k of kinds){const names=presetNames(k);if(!names)throw Error('unknown preset kind `'+k+'`');out[k]=names;}
    return out;
  }
  const data=libraries(),i=indexOf(kind,query);
  const list=kind==='brushes'?data.brushes:kind==='patterns'?data.patterns:data.customShapes;
  if(action==='rename'){const name=(query.newName||'').trim();if(!name)throw Error('missing `newName`');list[i].name=name;if(kind==='brushes')list[i].builtin=false;}
  else if(action==='delete')list.splice(i,1);
  else if(action==='move'){if(!Number.isInteger(query.to))throw Error('missing `to`');moveItem(list,i,query.to);}
  else throw Error('unknown action `'+action+'` (list|rename|delete|move)');
  save(data);
  return {[kind]:presetNames(kind)};
}

export function defineBrushTip(doc,layer,name){
  if(!doc.selection)throw Error('no selection');
  const cover=doc.selectionCoverage();
  let x0=doc.width,y0=doc.height,x1=0,y1=0;
  for(let i=0;i<cover.length;i++)if(cover[i]){const x=i%doc.width,y=(i/doc.width)|0;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  if(x1<=x0)throw Error('the selection is empty');
  const stored=doc.colorMode&&doc.colorMode!=='rgb'?deviceImageData(doc,layer):null,image=stored||layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height);
  const w=x1-x0,h=y1-y0,v=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=x0+x,dy=y0+y,lx=dx-(layer.x||0),ly=dy-(layer.y||0);
    if(lx<0||ly<0||lx>=image.width||ly>=image.height)continue;
    const p=(ly*image.width+lx)*4,r=image.data[p]/255,g=image.data[p+1]/255,b=image.data[p+2]/255,a=image.data[p+3]/255;
    const lum=0.3*r+0.59*g+0.11*b;
    v[y*w+x]=Math.max(0,Math.min(1,(1-lum)*a*(cover[dy*doc.width+dx]/255)));
  }
  let cx0=w,cy0=h,cx1=0,cy1=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(v[y*w+x]>1e-4){cx0=Math.min(cx0,x);cy0=Math.min(cy0,y);cx1=Math.max(cx1,x+1);cy1=Math.max(cy1,y+1);}
  if(cx1<=cx0)throw Error('the selected pixels contain no paint (all white or transparent)');
  const tw=cx1-cx0,th=cy1-cy0;
  if(Math.max(tw,th)>2500)throw Error('selection too large for a brush tip ('+tw+'×'+th+'; max 2500 px)');
  const data=[];
  for(let y=cy0;y<cy1;y++)for(let x=cx0;x<cx1;x++)data.push(v[y*w+x]);
  const libs=libraries();
  const preset={name,builtin:false,group:'',folder:[],size:Math.max(tw,th),spacing:.25,tip:{width:tw,height:th,data}};
  const at=libs.brushes.findIndex(b=>b.name===name);
  if(at>=0)libs.brushes[at]=preset;else libs.brushes.push(preset);
  save(libs);
  return {name,width:tw,height:th,preset};
}

export function definePatternFromDocument(doc,name){
  const bounds=doc.selection?null: {x:0,y:0,w:doc.width,h:doc.height};
  let x0=doc.width,y0=doc.height,x1=0,y1=0;
  if(doc.selection){const cover=doc.selectionCoverage();for(let i=0;i<cover.length;i++)if(cover[i]){const x=i%doc.width,y=(i/doc.width)|0;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}}
  else {x0=bounds.x;y0=bounds.y;x1=bounds.w;y1=bounds.h;}
  if(x1<=x0||y1<=y0)throw Error('the area is empty');
  const w=x1-x0,h=y1-y0;
  if(w>4000||h>4000)throw Error('patterns are limited to 4000 × 4000 px');
  const native=doc.colorMode==='gray'?mergeGrayDocument(doc,doc.layers):null;
  let image;
  if(native&&native.samples.length===doc.width*doc.height){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=(y0+y)*doc.width+x0+x,di=(y*w+x)*4,g=native.samples[si];data[di]=data[di+1]=data[di+2]=g;data[di+3]=native.alpha[si];}image={width:w,height:h,data};}
  else image=doc.composite().getContext('2d').getImageData(x0,y0,w,h);
  const device=patternFromComposite(doc,image);
  let channels,pixels,mode=doc.colorMode||'rgb';
  if(device){channels=device.channels;pixels=device.pixels;mode=device.mode;}
  else{let opaque=true;for(let i=3;i<image.data.length;i+=4)if(image.data[i]<255){opaque=false;break;}pixels=[];for(let i=0;i<image.data.length;i+=4){pixels.push(image.data[i],image.data[i+1],image.data[i+2]);if(!opaque)pixels.push(image.data[i+3]);}channels=opaque?3:4;mode='rgb';}
  const libs=libraries();
  const id=crypto.randomUUID();
  const pat={id,name,width:w,height:h,mode,channels,pixels};
  if(!libs.patterns.some(q=>q.id===id))libs.patterns.push(pat);
  save(libs);
  return pat;
}

export function patternDefaultName(doc){
  const base=(doc?.name||'Pattern').replace(/\.[^.]+$/,'')||'Pattern';
  const names=new Set(libraries().patterns.map(p=>p.name));
  if(!names.has(base))return base;
  for(let i=2;i<10000;i++)if(!names.has(base+' '+i))return base+' '+i;
  return base;
}

export function defineCustomShape(doc,name,path=null){
  path=path||(doc.activePath?.nodes?.length?structuredClone(doc.activePath):doc.active?.shape?structuredClone(doc.active.shape):doc.active?.vectorMask?structuredClone(doc.active.vectorMask):null);
  if(!path)throw Error('select a path or shape layer first');
  const libs=libraries();
  const found=libs.customShapes.find(s=>s.name===name);
  if(found)found.path=path;else libs.customShapes.push({name,path});
  save(libs);
  return {name,count:libs.customShapes.length};
}

export function exportPresets(kinds=['brushes','customShapes'],includeBuiltins=false){
  const data=libraries(),want=k=>kinds.includes(k);
  const file={format:'photocraft-presets',version:1,brushes:want('brushes')?data.brushes.filter(b=>includeBuiltins||!b.builtin):[],customShapes:want('customShapes')?data.customShapes:[]};
  return {data:file,brushes:file.brushes.length,customShapes:file.customShapes.length};
}

export function importPresets(file,kinds=['brushes','customShapes']){
  if(typeof file==='string')file=JSON.parse(file);
  if(file.format!=='photocraft-presets')throw Error('not a preset file (format `'+file.format+'`)');
  const data=libraries();let brushes=0,customShapes=0;
  if(kinds.includes('brushes'))for(const brush of file.brushes||[]){brush.folder=(brush.folder||[]).filter(f=>String(f).trim()).slice(0,32);const at=data.brushes.findIndex(b=>b.name===brush.name);if(at>=0)data.brushes[at]=brush;else data.brushes.push(brush);brushes++;}
  if(kinds.includes('customShapes'))for(const shape of file.customShapes||[]){const at=data.customShapes.findIndex(s=>s.name===shape.name);if(at>=0)data.customShapes[at]=shape;else data.customShapes.push(shape);customShapes++;}
  save(data);
  return {brushes,customShapes};
}

function mergeGroups(cur,incoming){
  let added=0;
  for(const group of incoming||[])if(group&&typeof group.name==='string'&&!cur.some(e=>e.name===group.name)){cur.push(group);added++;}
  return added;
}

export function exportPatternPat(){return writePat(libraries().patterns);}
export function importPatternPat(bytes){const incoming=readPat(bytes),data=libraries();for(const pattern of incoming){const at=data.patterns.findIndex(item=>item.id===pattern.id||item.name===pattern.name);if(at>=0)data.patterns[at]=pattern;else data.patterns.push(pattern);}save(data);return incoming.length;}
export function migratePresets(text){
  const root=typeof text==='string'?JSON.parse(text):text;
  const v=root.presets||root;
  const data=libraries();
  const gradients=mergeGroups(data.gradients,v.gradients);
  const styles=mergeGroups(data.styles,v.styles);
  const shapes=mergeGroups(data.shapes,v.shapes);
  const patternGroups=mergeGroups(data.patternGroups,v.patternGroups||v.pattern_groups);
  let toolPresets=0;
  for(const preset of v.toolPresets||v.tool_presets||[])if(preset&&!data.toolPresets.some(e=>e.name===preset.name)){data.toolPresets.push(preset);toolPresets++;}
  const migrated=gradients+styles+shapes+patternGroups+toolPresets;
  if(migrated)save(data);
  return {migrated,added:{gradients,styles,shapes,patternGroups,toolPresets}};
}
