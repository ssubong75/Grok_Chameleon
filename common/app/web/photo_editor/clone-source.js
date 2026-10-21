// Window › Clone Source. Five slots, each with a sample point, offset, W/H, rotation and flips.
// The matrix maps a destination point onto the source: source + M · (destination − anchor).
export const SLOTS=5;
const MODES=['normal','darken','lighten','difference'];
function bad(message){return Error(message);}
function remEuclid(n,m){return ((n%m)+m)%m;}
function num(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function pair(value){if(!Array.isArray(value)||value.length<2)return null;const x=num(value[0]),y=num(value[1]);return x==null||y==null?null:[x,y];}
export function defaultCloneSource(){return {source:null,anchor:null,layer:null,scale:[100,100],rotation:0,flipH:false,flipV:false,linked:false,canvas:null};}
export function defaultCloneOverlay(){return {show:true,opacity:100,clipped:true,autoHide:true,invert:false,blend:'normal'};}
export function defaultCloneSources(){return {slots:Array.from({length:SLOTS},defaultCloneSource),active:0,overlay:defaultCloneOverlay()};}
export function cloneOffset(slot){if(!slot?.source||!slot.anchor)return null;return [slot.source[0]-slot.anchor[0],slot.source[1]-slot.anchor[1]];}
export function cloneSourceJson(slot,index){return {index,source:slot.source,anchor:slot.anchor,offset:cloneOffset(slot),layer:slot.layer,width:slot.scale[0],height:slot.scale[1],linked:slot.linked,rotation:slot.rotation,flipH:slot.flipH,flipV:slot.flipV};}
function activeSlot(sources){return sources.slots[Math.min(sources.active,SLOTS-1)];}
function slotIndex(sources,payload,command){const raw=payload?.index;if(raw==null)return sources.active;const i=Number(raw);if(!Number.isInteger(i)||i<0||i>=SLOTS)throw bad(`${command}: index ${raw} out of range (0..${SLOTS})`);return i;}
export function cloneSourceList(sources){return {active:sources.active,sources:sources.slots.map(cloneSourceJson),overlay:{...sources.overlay}};}
export function cloneSourceSelect(sources,payload){const raw=payload?.index;if(raw==null)throw bad('cloneSource.select: missing `index`');const i=slotIndex(sources,payload,'cloneSource.select');sources.active=i;return cloneSourceJson(sources.slots[i],i);}
export function cloneSourceSet(sources,payload={}){
  const i=slotIndex(sources,payload,'cloneSource.set'),slot=sources.slots[i];
  const source=pair(payload.source);
  if(source){slot.source=source;slot.anchor=null;slot.layer=payload.layer??slot.layer??null;}
  const offset=pair(payload.offset);
  if(offset){const anchor=slot.anchor||slot.source;if(!anchor)throw bad('cloneSource.set: set a `source` before an offset');slot.anchor=[anchor[0],anchor[1]];slot.source=[anchor[0]+offset[0],anchor[1]+offset[1]];}
  const scale=pair(payload.scale);if(scale)slot.scale=[scale[0],scale[1]];
  if(typeof payload.linked==='boolean')slot.linked=payload.linked;
  const before=slot.scale.slice(),width=num(payload.width),height=num(payload.height);
  if(width!=null)slot.scale[0]=width;if(height!=null)slot.scale[1]=height;
  if(slot.linked){if(width!=null&&height==null&&Math.abs(before[0])>1e-9)slot.scale[1]=before[1]*width/before[0];else if(height!=null&&width==null&&Math.abs(before[1])>1e-9)slot.scale[0]=before[0]*height/before[1];}
  if(slot.scale.some(v=>Math.abs(v)<1||Math.abs(v)>1000))slot.scale=slot.scale.map(v=>Math.min(1000,Math.max(1,v)));
  if(num(payload.rotation)!=null)slot.rotation=remEuclid(payload.rotation+180,360)-180;
  if(typeof payload.flipH==='boolean')slot.flipH=payload.flipH;
  if(typeof payload.flipV==='boolean')slot.flipV=payload.flipV;
  if(payload.clear===true){const canvas=slot.canvas;Object.assign(slot,defaultCloneSource());slot.canvas=canvas;}
  if(payload.select!==false)sources.active=i;
  return cloneSourceJson(slot,i);
}
export function cloneSourceResetTransform(sources,payload){const i=slotIndex(sources,payload,'cloneSource.resetTransform'),slot=sources.slots[i];slot.scale=[100,100];slot.rotation=0;slot.flipH=false;slot.flipV=false;return cloneSourceJson(slot,i);}
export function cloneSourceOverlay(sources,payload={}){
  const overlay=sources.overlay;
  if(typeof payload.show==='boolean')overlay.show=payload.show;
  if(num(payload.opacity)!=null)overlay.opacity=Math.min(100,Math.max(0,payload.opacity));
  if(typeof payload.clipped==='boolean')overlay.clipped=payload.clipped;
  if(typeof payload.autoHide==='boolean')overlay.autoHide=payload.autoHide;
  if(typeof payload.invert==='boolean')overlay.invert=payload.invert;
  if(payload.blend!=null){if(!MODES.includes(payload.blend))throw bad(`cloneSource.overlay: unknown overlay mode \`${payload.blend}\` (normal|darken|lighten|difference)`);overlay.blend=payload.blend;}
  return {...overlay};
}
export function transformMatrix(scale,rotation,flipH,flipV){
  const sx=Math.max(1e-3,scale[0]/100)*(flipH?-1:1),sy=Math.max(1e-3,scale[1]/100)*(flipV?-1:1),rad=-rotation*Math.PI/180,s=Math.sin(rad),c=Math.cos(rad);
  const f=[c*sx,-s*sy,s*sx,c*sy],det=f[0]*f[3]-f[1]*f[2];
  return [f[3]/det,-f[1]/det,-f[2]/det,f[0]/det];
}
export function mappingIsTranslation(m){return Math.abs(m[0]-1)<1e-12&&Math.abs(m[1])<1e-12&&Math.abs(m[2])<1e-12&&Math.abs(m[3]-1)<1e-12;}
function mapPoint(mapping,x,y){const dx=x-mapping.anchor[0],dy=y-mapping.anchor[1];return [mapping.source[0]+mapping.m[0]*dx+mapping.m[1]*dy,mapping.source[1]+mapping.m[2]*dx+mapping.m[3]*dy];}
function apron(v,pad){const n=Math.min(2147483647,Math.max(-2147483648,v));return Math.min(2147483647,Math.max(-2147483648,n+pad));}
export function sourceRect(mapping,rect){
  const pts=[[rect[0],rect[1]],[rect[2],rect[1]],[rect[0],rect[3]],[rect[2],rect[3]]].map(([x,y])=>mapPoint(mapping,x,y));
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of pts){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  return [apron(Math.floor(x0),-2),apron(Math.floor(y0),-2),apron(Math.ceil(x1),2),apron(Math.ceil(y1),2)];
}
export function resolveClone(sources,payload,first){
  const aligned=payload?.aligned!==false,slot=activeSlot(sources);
  const explicit=['scale','rotation','flipH','flipV'].some(key=>payload?.[key]!=null);
  const m=explicit?transformMatrix(pair(payload.scale)||[100,100],num(payload.rotation)||0,payload.flipH===true,payload.flipV===true):transformMatrix(slot.scale,slot.rotation,slot.flipH,slot.flipV);
  const anchorParam=pair(payload?.anchor),offset=pair(payload?.offset),given=pair(payload?.source);
  if(offset){const anchor=anchorParam||first;return {mapping:{source:[anchor[0]+offset[0],anchor[1]+offset[1]],anchor,m},storeAnchor:null};}
  if(given)return {mapping:{source:given,anchor:anchorParam||first,m},storeAnchor:null};
  if(!slot.source)throw bad('missing `source` ([x,y]) or `offset` ([dx,dy]); or set one with cloneSource.set');
  const anchor=aligned&&slot.anchor?slot.anchor.slice():first.slice();
  return {mapping:{source:slot.source.slice(),anchor,m},storeAnchor:aligned?anchor.slice():null};
}
export function placeCloneStroke(sources,point,aligned){
  const placed=resolveClone(sources,{aligned},[point.x,point.y]);
  if(placed.storeAnchor)activeSlot(sources).anchor=placed.storeAnchor.slice();
  const mapping=placed.mapping,translation=mappingIsTranslation(mapping.m);
  return {mapping,translation,offset:{x:mapping.anchor[0]-mapping.source[0],y:mapping.anchor[1]-mapping.source[1]}};
}
export function overlayBlend(mode,src,dst){
  const mix=mode==='darken'?Math.min:mode==='lighten'?Math.max:mode==='difference'?(s,d)=>Math.abs(s-d):null;
  if(!mix)return src.slice();
  const a=Math.min(1,Math.max(0,dst[3])),out=src.slice();
  for(let c=0;c<3;c++)out[c]=src[c]+(mix(src[c],dst[c])-src[c])*a;
  return out;
}
function sampleBilinear(data,width,height,channels,x,y){
  const fx=x-0.5,fy=y-0.5,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0,out=new Array(channels).fill(0);
  const at=(px,py)=>{if(px<0||py<0||px>=width||py>=height)return new Array(channels).fill(0);const i=(py*width+px)*channels,row=[];for(let c=0;c<channels;c++)row.push(data[i+c]);if(channels>1){const a=row[channels-1]/255;for(let c=0;c<channels-1;c++)row[c]*=a;row[channels-1]=a*255;}return row;};
  const q=[at(x0,y0),at(x0+1,y0),at(x0,y0+1),at(x0+1,y0+1)];
  for(let c=0;c<channels;c++){const top=q[0][c]+(q[1][c]-q[0][c])*tx,bot=q[2][c]+(q[3][c]-q[2][c])*tx;out[c]=top+(bot-top)*ty;}
  if(channels>1){const a=out[channels-1];for(let c=0;c<channels-1;c++)out[c]=a>1e-3?out[c]*255/a:0;}
  return out;
}
export function fillMappedImage(source,originX,originY,width,height,mapping){
  const image=source.getContext('2d').getImageData(0,0,source.width,source.height),out=new ImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const [sx,sy]=mapPoint(mapping,originX+x+0.5,originY+y+0.5),sample=sampleBilinear(image.data,image.width,image.height,4,sx,sy),i=(y*width+x)*4;
    for(let c=0;c<4;c++)out.data[i+c]=Math.round(Math.min(255,Math.max(0,sample[c])));
  }
  return out;
}
export function paintMappedClone(target,source,from,to,mapping,{width=24,opacity=1,clip=null,layerX=0,layerY=0}={}){
  const radius=width/2+2,left=Math.max(0,Math.floor(Math.min(from.x,to.x)-radius)),top=Math.max(0,Math.floor(Math.min(from.y,to.y)-radius)),right=Math.min(target.width,Math.ceil(Math.max(from.x,to.x)+radius)),bottom=Math.min(target.height,Math.ceil(Math.max(from.y,to.y)+radius));
  if(right<=left||bottom<=top)return;
  const tile=document.createElement('canvas');tile.width=right-left;tile.height=bottom-top;
  const coverage=document.createElement('canvas');coverage.width=tile.width;coverage.height=tile.height;const mask=coverage.getContext('2d');mask.lineWidth=width;mask.lineCap='round';mask.strokeStyle='#fff';mask.beginPath();mask.moveTo(from.x-left,from.y-top);mask.lineTo(to.x-left+.0001,to.y-top+.0001);mask.stroke();
  const weights=mask.getImageData(0,0,tile.width,tile.height).data,pixels=fillMappedImage(source,left+layerX,top+layerY,tile.width,tile.height,mapping);
  for(let i=0;i<weights.length;i+=4)pixels.data[i+3]=Math.round(pixels.data[i+3]*weights[i+3]/255);
  tile.getContext('2d').putImageData(pixels,0,0);
  const ctx=target.getContext('2d');ctx.save();if(clip)clip(ctx);ctx.globalAlpha=opacity;ctx.drawImage(tile,left,top);ctx.restore();
}
export function cloneOverlayPatch(source,under,at,radius,mapping,overlay){
  const x0=Math.floor(at[0]-radius),y0=Math.floor(at[1]-radius),x1=Math.ceil(at[0]+radius),y1=Math.ceil(at[1]+radius),width=Math.max(0,x1-x0),height=Math.max(0,y1-y0);
  if(!width||!height||width*height>4000000)return null;
  const sampled=fillMappedImage(source,x0,y0,width,height,mapping),below=under?under.getContext('2d').getImageData(Math.max(0,x0),Math.max(0,y0),Math.min(under.width,x0+width)-Math.max(0,x0),Math.min(under.height,y0+height)-Math.max(0,y0)):null;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,dx=x0+x+0.5-at[0],dy=y0+y+0.5-at[1];
    if(overlay.clipped&&dx*dx+dy*dy>radius*radius){sampled.data[i+3]=0;continue;}
    let px=[sampled.data[i]/255,sampled.data[i+1]/255,sampled.data[i+2]/255,sampled.data[i+3]/255];
    if(overlay.invert)for(let c=0;c<3;c++)px[c]=1-px[c];
    if(overlay.blend!=='normal'&&below){const bx=x0+x-Math.max(0,x0),by=y0+y-Math.max(0,y0);if(bx>=0&&by>=0&&bx<below.width&&by<below.height){const j=(by*below.width+bx)*4;px=overlayBlend(overlay.blend,px,[below.data[j]/255,below.data[j+1]/255,below.data[j+2]/255,below.data[j+3]/255]);}}
    for(let c=0;c<4;c++)sampled.data[i+c]=Math.round(Math.min(255,Math.max(0,px[c]*255)));
  }
  return {x:x0,y:y0,image:sampled};
}
export function cloneSourcePanelOpen(){const panel=document.getElementById('clone-source-panel');return Boolean(panel&&!panel.hidden);}
export function refreshCloneSourcePanel(){const panel=document.getElementById('clone-source-panel');if(panel&&!panel.hidden&&panel._paint)panel._paint();}
export function openCloneSourcePanel({getSources,getDocument,onChange}){
  const existing=document.getElementById('clone-source-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;if(!panel){panel=document.createElement('section');panel.id='clone-source-panel';panel.style.cssText='position:fixed;right:16px;top:420px;z-index:40;width:280px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  const sources=()=>getSources();
  const field=(label,value,apply)=>{const wrap=document.createElement('label');wrap.style.cssText='display:flex;gap:4px;align-items:center';wrap.append(label);const input=document.createElement('input');input.type='number';input.value=String(Math.round(value*100)/100);input.style.width='64px';input.onchange=()=>apply(Number(input.value));wrap.append(input);return wrap;};
  const button=(text,on)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=on;return node;};
  const paint=()=>{
    const data=sources(),slot=data.slots[data.active],doc=getDocument?.();
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Clone Source';const close=button('×',()=>{panel.hidden=true;});title.append(name,close);
    const slots=document.createElement('div');slots.style.display='flex';slots.style.gap='4px';
    data.slots.forEach((item,index)=>{const node=button(String(index+1),()=>{onChange(cloneSourceSelect(data,{index}));paint();});node.title=item.source?`Clone source ${index+1}: ${Math.round(item.source[0])}, ${Math.round(item.source[1])}`:`Clone source ${index+1} (Alt-click with Clone Stamp to set)`;node.style.outline=index===data.active?'2px solid #6cf':'';if(item.source)node.textContent=`${index+1} •`;slots.append(node);});
    const layer=slot.layer!=null&&doc?.layers?.find(item=>item.id===slot.layer);
    const line=document.createElement('div');line.textContent=slot.source&&layer?`Source: ${doc.name||''} : ${layer.name}`:slot.source?'Source: set':'Source: not set (Alt-click with Clone Stamp)';
    const off=cloneOffset(slot)||[0,0],grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:auto auto auto;gap:4px;align-items:center';
    const apply=patch=>{onChange(cloneSourceSet(data,patch));paint();};
    grid.append(field('X',off[0],value=>slot.source&&apply({offset:[value,off[1]]})),field('W',slot.scale[0],value=>apply({width:value})),button(slot.linked?'Link':'Unlink',()=>apply({linked:!slot.linked})));
    grid.append(field('Y',off[1],value=>slot.source&&apply({offset:[off[0],value]})),field('H',slot.scale[1],value=>apply({height:value})),document.createElement('span'));
    const flips=document.createElement('span');flips.append(button(slot.flipH?'Flip H on':'Flip H',()=>apply({flipH:!slot.flipH})),button('Reset',()=>{onChange(cloneSourceResetTransform(data,{}));paint();}));
    grid.append(field('A',slot.rotation,value=>apply({rotation:value})),flips,button(slot.flipV?'Flip V on':'Flip V',()=>apply({flipV:!slot.flipV})));
    const overlay=data.overlay,checks=document.createElement('div');
    const check=(text,key)=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=overlay[key];input.onchange=()=>{onChange(cloneSourceOverlay(data,{[key]:input.checked}));paint();};label.append(input,text);return label;};
    checks.append(check('Show Overlay','show'),field('Opacity',overlay.opacity,value=>{onChange(cloneSourceOverlay(data,{opacity:value}));paint();}));
    const mode=document.createElement('select');for(const item of MODES){const option=document.createElement('option');option.value=item;option.textContent=item;mode.append(option);}mode.value=overlay.blend;mode.onchange=()=>{onChange(cloneSourceOverlay(data,{blend:mode.value}));};
    checks.append(check('Clipped','clipped'),check('Auto Hide','autoHide'),check('Invert','invert'),mode);
    panel.replaceChildren(title,slots,line,grid,checks);
  };
  panel._paint=paint;paint();
}
