import {colorAmount,completeTexture,fitPatch} from './content-aware.js';
export function bandWidth(structure,minSide){const side=Math.max(0,minSide),w=structure<=1?Math.max(side*.3,12):structure===2?Math.max(side*.18,9):6;return Math.min(128,Math.round(w));}
export function erode(w,h,mask,r){if(!r)return mask.slice();const stride=w+1,sat=new Uint32Array(stride*(h+1));for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=mask[y*w+x]?1:0;sat[(y+1)*stride+x+1]=sat[y*stride+x+1]+row;}}const out=new Uint8Array(w*h);for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);for(let x=0;x<w;x++){if(!mask[y*w+x])continue;const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),set=sat[y1*stride+x1]+sat[y0*stride+x0]-sat[y0*stride+x1]-sat[y1*stride+x0];out[y*w+x]=set===(x1-x0)*(y1-y0)?1:0;}}return out;}
function fill(data,hole,w,h){if(!hole.some(Boolean)||hole.every(Boolean))return data;try{const filled=completeTexture(w,h,data,hole,{radius:3,iterations:4,seed:0xca4e00});const out=new Uint8ClampedArray(data);for(let i=0;i<hole.length;i++)if(hole[i])out.set(filled.subarray(i*4,i*4+4),i*4);return out;}catch{return data;}}
export function colorShift(from,to,color){const adapt=colorAmount(color);if(!adapt||!from.length||!to.length)return null;const moments=samples=>{const s=[0,0,0],s2=[0,0,0];for(const p of samples)for(let c=0;c<3;c++){const v=p[c]/255;s[c]+=v;s2[c]+=v*v;}return {s,s2,n:samples.length};};const f=moments(from),t=moments(to),k=f.n/t.n;return [0,1,2].map(c=>fitPatch(f.n,t.s[c]*k,t.s2[c]*k,f.s[c],f.s2[c],adapt));}
export function moveContent(image,mask,dx,dy,mode='move',structure=4,color=0){
  const w=image.width,h=image.height,data=image.data,dest=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h)dest[ny*w+nx]=1;}
  let work=new Uint8ClampedArray(data);
  if(mode!=='extend')work=fill(work,Uint8Array.from(mask),w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;work.set(data.subarray((y*w+x)*4,(y*w+x)*4+4),(ny*w+nx)*4);}
  let minSide=Math.min(w,h);const xs=[],ys=[];dest.forEach((v,i)=>{if(v){xs.push(i%w);ys.push(Math.floor(i/w));}});if(xs.length)minSide=Math.min(Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1);
  const core=erode(w,h,dest,bandWidth(structure,minSide)),edge=Uint8Array.from(dest,(v,i)=>v&&!core[i]?1:0);
  if(mode!=='extend')for(let i=0;i<mask.length;i++)if(mask[i]&&!dest[i])edge[i]=1;
  const band=Uint8Array.from(dest,(v,i)=>v&&!core[i]?1:0);
  if(band.some(Boolean)){const sample=fill(work,edge,w,h);for(let i=0;i<band.length;i++)if(band[i])work.set(sample.subarray(i*4,i*4+4),i*4);}
  const shift=colorShift(samples(data,mask),samples(data,dest),color);if(shift)for(let i=0;i<dest.length;i++)if(dest[i]){const o=i*4;for(let c=0;c<3;c++)work[o+c]=Math.max(0,Math.min(255,Math.round(shift[c][0]*work[o+c]+shift[c][1]*255)));}
  return work;
}
function samples(data,mask){const out=[];for(let i=0;i<mask.length;i++)if(mask[i])out.push([data[i*4],data[i*4+1],data[i*4+2]]);return out;}
export function installContentAwareMoveOptions({state}){
  const bar=document.createElement('span');bar.id='cam-option';bar.hidden=true;state.contentAwareMove=state.contentAwareMove||{mode:'move',structure:4,color:0};
  for(const [value,label] of [['move','Move'],['extend','Extend']]){const input=document.createElement('input');input.type='radio';input.name='cam-mode';input.value=value;input.checked=value==='move';input.setAttribute('aria-label',label);input.onchange=()=>{if(input.checked)state.contentAwareMove.mode=value;};bar.append(input,' '+label+' ');}
  const number=(key,label,min,max,value)=>{const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max);input.value=String(value);input.setAttribute('aria-label',label);input.onchange=()=>{state.contentAwareMove[key]=Math.max(min,Math.min(max,Math.round(Number(input.value)||value)));input.value=String(state.contentAwareMove[key]);};bar.append(label+' ',input,' ');};
  number('structure','Structure',1,7,4);number('color','Color',0,10,0);document.getElementById('options').append(bar);return bar;
}
