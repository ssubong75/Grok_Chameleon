// PhotoCraft crates/algo/src/pyramid.rs fuse_stack: per-band maximum region energy.

import {collapse,gaussian,laplacian,reduce} from './pyramid-blend.js';

const HALO_MAX=8,HALO_REF=1e-4,HALO_FLOOR=1e-8,COVERED=0.5,NO_ENERGY=-1;

function binomial(r){
  const n=2*r+1,row=Array(n).fill(1);
  for(let i=1;i<n;i++)for(let j=i-1;j>=1;j--)row[j]+=row[j-1];
  const s=row.reduce((a,b)=>a+b,0);
  return row.map(v=>v/s);
}

function windowSum(w,h,src,wt){
  const r=Math.floor(wt.length/2);
  if(!r||!w||!h)return src.slice();
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let t=0;t<wt.length;t++)s+=wt[t]*src[y*w+Math.max(0,Math.min(w-1,x+t-r))];tmp[y*w+x]=s;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let t=0;t<wt.length;t++)s+=wt[t]*tmp[Math.max(0,Math.min(h-1,y+t-r))*w+x];out[y*w+x]=s;}
  return out;
}

function regionEnergy(level,cover,win){
  const e=level.px.map(v=>v*v),re=windowSum(level.w,level.h,e,win);
  for(let i=0;i<re.length;i++)if(cover.px[i]<COVERED)re[i]=NO_ENERGY;
  return re;
}

function haloWeight(re,p){return Math.exp(Math.max(-60,Math.min(60,p*Math.log((Math.max(0,re)+HALO_FLOOR)/HALO_REF))));}

function deviationEntropy(w,h,y){
  const R=2,BINS=256,n=25,dev=new Float32Array(w*h),ent=new Float32Array(w*h);
  for(let i=0;i<h;i++)for(let j=0;j<w;j++){
    let s=0,s2=0;const hist=new Uint32Array(BINS),touched=[];
    for(let dy=0;dy<=4;dy++)for(let dx=0;dx<=4;dx++){
      const v=y[Math.max(0,Math.min(h-1,i+dy-R))*w+Math.max(0,Math.min(w-1,j+dx-R))];
      s+=v;s2+=v*v;const q=Math.min(BINS-1,Math.max(0,Math.round(Math.max(0,Math.min(1,v))*(BINS-1))));
      if(!hist[q])touched.push(q);hist[q]++;
    }
    const mean=s/n;dev[i*w+j]=Math.max(0,s2/n-mean*mean);
    let e=0;for(const q of touched){const p=hist[q]/n;e-=p*Math.log(p);}ent[i*w+j]=e;
  }
  return [dev,ent];
}

function fuseResiduals(tops,ch){
  const {w,h}=tops[0].px,n=tops.length,measures=tops.map(t=>deviationEntropy(w,h,t.luma)),out=new Float32Array(w*h*ch);
  for(let i=0;i<w*h;i++){
    const any=tops.some(t=>t.cover[i]>=COVERED),eligible=a=>!any||tops[a].cover[i]>=COVERED,keep=[];
    for(let a=0;a<n;a++){
      const da=measures[a][0][i],ea=measures[a][1][i];
      const dominated=eligible(a)&&measures.some((m,b)=>b!==a&&eligible(b)&&m[0][i]>=da&&m[1][i]>=ea&&(m[0][i]>da||m[1][i]>ea));
      keep[a]=eligible(a)&&!dominated;
    }
    const kept=keep.filter(Boolean).length||1,inv=1/kept;
    tops.forEach((t,a)=>{if(!keep[a])return;for(let c=0;c<ch;c++)out[i*ch+c]+=t.px.px[i*ch+c]*inv;});
  }
  return {w,h,px:out};
}

function foldHalo(acc,wsum,src,g,wgt,ch){
  let weight=wgt;
  for(let li=g+1;li<acc.length;li++){
    weight=reduce(weight,1);
    const a=acc[li],wp=weight.px;
    if(src){
      const s=wsum[li-g-1],sp=src[li].px;
      for(let i=0;i<wp.length;i++)s[i]+=wp[i];
      for(let i=0;i<wp.length;i++)for(let c=0;c<ch;c++)a.px[i*ch+c]+=wp[i]*sp[i*ch+c];
    }else{
      wsum.push(Float32Array.from(wp));
      for(let i=0;i<wp.length;i++)for(let c=0;c<ch;c++)a.px[i*ch+c]*=wp[i];
    }
  }
}

export function stackLevels(w,h){let n=1,s=Math.min(w,h);while(Math.ceil(s/2)>=32&&n<10){s=Math.ceil(s/2);n++;}return n;}

function boxBlur(w,h,src,r){
  const pass=(input,horizontal)=>{
    const dst=new Float32Array(input.length),n=horizontal?h:w,m=horizontal?w:h;
    const at=(line,k)=>{k=Math.max(0,Math.min(m-1,k));return horizontal?input[line*w+k]:input[k*w+line];};
    for(let line=0;line<n;line++){
      let s=0;for(let k=-r;k<=r;k++)s+=at(line,k);
      for(let k=0;k<m;k++){const i=horizontal?line*w+k:k*w+line;dst[i]=s/(2*r+1);s+=at(line,k+r+1)-at(line,k-r);}
    }
    return dst;
  };
  return pass(pass(src,true),false);
}

export function stackWeights(w,h,luma,alpha){
  const radius=Math.max(2,Math.min(12,Math.floor(Math.min(w,h)/64)));
  const scores=luma.map((l,index)=>{
    const lap=new Float32Array(w*h),a=alpha[index];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=(xx,yy)=>l[yy*w+xx],xl=Math.max(0,x-1),xr=Math.min(w-1,x+1),yu=Math.max(0,y-1),yd=Math.min(h-1,y+1);
      lap[y*w+x]=Math.abs(p(xl,y)+p(xr,y)+p(x,yu)+p(x,yd)-4*p(x,y));
    }
    const blurred=boxBlur(w,h,lap,radius),score=new Float32Array(w*h);
    for(let i=0;i<score.length;i++)score[i]=a[i]>0.5?blurred[i]:-1;
    return score;
  });
  const weights=scores.map(()=>new Float32Array(w*h));
  for(let i=0;i<w*h;i++){let best=0,score=-Infinity;scores.forEach((s,k)=>{if(s[i]>score){score=s[i];best=k;}});if(score>-Infinity)weights[best][i]=1;}
  return weights;
}

export function fuseStack(w,h,ch,images,luma,alpha,options={}){
  const want=Math.max(1,options.levels||stackLevels(w,h));
  let levels=1,a=w,b=h;
  while((a>1||b>1)&&levels<want){a=Math.ceil(a/2);b=Math.ceil(b/2);levels++;}
  const bands=levels-1,halo=bands>0&&(options.halo??2)>0?[Math.min(options.guide??2,bands-1),Math.min(options.halo??2,HALO_MAX)]:null;
  const nsel=halo?halo[0]+1:bands,win=binomial(options.energyRadius??1);
  let acc=[],best=[],wsum=[],tops=[];
  images.forEach((img,index)=>{
    const lp=laplacian(w,h,ch,img,levels),ll=laplacian(w,h,1,luma[index],levels),ga=gaussian(w,h,1,alpha[index],levels);
    if(lp.length!==levels)return;
    if(!halo)tops.push({px:lp.at(-1),luma:ll.at(-1).px,cover:ga.at(-1).px});
    const energies=Array.from({length:nsel},(_,li)=>regionEnergy(ll[li],ga[li],win));
    const wgt=halo?{w:ll[halo[0]].w,h:ll[halo[0]].h,px:energies[halo[0]].map(e=>e<0?0:haloWeight(e,halo[1]))}:null;
    if(!acc.length){acc=lp;best=energies;if(halo)foldHalo(acc,wsum,null,halo[0],wgt,ch);return;}
    for(let li=0;li<nsel;li++){
      const take=energies[li].map((e,i)=>{if(e>best[li][i]){best[li][i]=e;return true;}return false;});
      const lvl=lp[li];
      for(let i=0;i<take.length;i++)if(take[i])for(let c=0;c<ch;c++)acc[li].px[i*ch+c]=lvl.px[i*ch+c];
    }
    if(halo)foldHalo(acc,wsum,lp,halo[0],wgt,ch);
  });
  if(!acc.length)return new Float32Array(w*h*ch);
  if(halo){for(let li=halo[0]+1;li<levels;li++){const s=wsum[li-halo[0]-1];for(let i=0;i<s.length;i++)for(let c=0;c<ch;c++)acc[li].px[i*ch+c]=s[i]>0?acc[li].px[i*ch+c]/s[i]:0;}}
  else if(acc.length)acc[acc.length-1]=fuseResiduals(tops,ch);
  return Float32Array.from(collapse(acc,ch),v=>Math.max(0,Math.min(1,v)));
}
