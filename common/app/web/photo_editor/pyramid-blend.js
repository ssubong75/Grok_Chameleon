// PhotoCraft crates/algo/src/pyramid.rs: Burt & Adelson REDUCE / EXPAND / Laplacian blend.

const K=[1/16,4/16,6/16,4/16,1/16];

export function reduce(level,ch){
  const w=Math.ceil(level.w/2),h=Math.ceil(level.h/2),tmp=new Float32Array(w*level.h*ch),px=new Float32Array(w*h*ch);
  for(let y=0;y<level.h;y++)for(let x=0;x<w;x++)for(let k=0;k<5;k++){const sx=Math.max(0,Math.min(level.w-1,2*x+k-2));for(let c=0;c<ch;c++)tmp[(y*w+x)*ch+c]+=K[k]*level.px[(y*level.w+sx)*ch+c];}
  for(let y=0;y<h;y++)for(let k=0;k<5;k++){const sy=Math.max(0,Math.min(level.h-1,2*y+k-2));for(let x=0;x<w;x++)for(let c=0;c<ch;c++)px[(y*w+x)*ch+c]+=K[k]*tmp[(sy*w+x)*ch+c];}
  return {w,h,px};
}

function expand(level,ch,w,h){
  const tmp=new Float32Array(w*level.h*ch),out=new Float32Array(w*h*ch);
  for(let y=0;y<level.h;y++)for(let x=0;x<w;x++)for(let k=0;k<5;k++){const t=x+k-2;if((t&1)!==0)continue;const sx=Math.max(0,Math.min(level.w-1,t>>1));for(let c=0;c<ch;c++)tmp[(y*w+x)*ch+c]+=2*K[k]*level.px[(y*level.w+sx)*ch+c];}
  for(let y=0;y<h;y++)for(let k=0;k<5;k++){const t=y+k-2;if((t&1)!==0)continue;const sy=Math.max(0,Math.min(level.h-1,t>>1));for(let x=0;x<w;x++)for(let c=0;c<ch;c++)out[(y*w+x)*ch+c]+=2*K[k]*tmp[(sy*w+x)*ch+c];}
  return out;
}

export function gaussian(w,h,ch,px,levels){
  const out=[{w,h,px}];
  while(out.length<Math.max(1,levels)){const last=out.at(-1);if(last.w<=1&&last.h<=1)break;out.push(reduce(last,ch));}
  return out;
}

export function laplacian(w,h,ch,px,levels){
  const g=gaussian(w,h,ch,px,levels);
  return g.map((level,i)=>i+1===g.length?level:{w:level.w,h:level.h,px:level.px.map((value,index)=>value-expand(g[i+1],ch,level.w,level.h)[index])});
}

export function collapse(pyr,ch){
  let cur=pyr.at(-1)||{w:0,h:0,px:new Float32Array()};
  for(let i=pyr.length-2;i>=0;i--){const up=expand(cur,ch,pyr[i].w,pyr[i].h),px=pyr[i].px.map((value,index)=>value+up[index]);cur={w:pyr[i].w,h:pyr[i].h,px};}
  return cur.px;
}

export function autoLevels(w,h){let n=1,s=Math.min(w,h);while(s>8&&n<10){s=Math.floor(s/2);n++;}return n;}

export function pyramidBlend(w,h,ch,images,weights,levels){
  levels=Math.max(1,levels);
  let acc=null,wsum=null;
  images.forEach((img,index)=>{
    const lp=laplacian(w,h,ch,img,levels),gp=gaussian(w,h,1,weights[index],levels);
    if(!acc){acc=lp.map(l=>({w:l.w,h:l.h,px:new Float32Array(l.px.length)}));wsum=gp.map(l=>({w:l.w,h:l.h,px:new Float32Array(l.px.length)}));}
    lp.forEach((l,li)=>{const g=gp[li];for(let i=0;i<l.w*l.h;i++){const k=g.px[i];wsum[li].px[i]+=k;for(let c=0;c<ch;c++)acc[li].px[i*ch+c]+=k*l.px[i*ch+c];}});
  });
  if(!acc)return new Float32Array(w*h*ch);
  acc.forEach((l,li)=>{const s=wsum[li];for(let i=0;i<l.w*l.h;i++){const k=s.px[i];for(let c=0;c<ch;c++)l.px[i*ch+c]=k>1e-6?l.px[i*ch+c]/k:0;}});
  return Float32Array.from(collapse(acc,ch),v=>Math.max(0,Math.min(1,v)));
}
