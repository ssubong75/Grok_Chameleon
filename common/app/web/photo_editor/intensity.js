// PhotoCraft crates/algo/src/direct.rs: intensity registration by Nelder-Mead on a Gaussian pyramid.

import {Homography} from './features.js';

const K=[1/16,4/16,6/16,4/16,1/16];
const SPAN=[0.10,0.10,0.10,0.08726646259971647,0.05,0.05,0.05,0.05];
const FREE={translation:[0,1],similarity:[0,1,2,3],homography:[0,1,2,3,4,5,6,7]};

function poseMatrix(v,w,h){
  const [dx,dy,scale,rot,aspect,shear,px,py]=v;
  const cx=w/2,cy=h/2,c=Math.cos(rot),s=Math.sin(rot);
  const a=scale*c,b=scale*(c*shear-s*aspect),d=scale*s,e=scale*(s*shear+c*aspect);
  const gx=px/w,gy=py/h;
  const a2=a+cx*gx,b2=b+cx*gy,d2=d+cy*gx,e2=e+cy*gy;
  const tx=cx+dx*w-(a2*cx+b2*cy),ty=cy+dy*h-(d2*cx+e2*cy);
  return new Homography([a2,b2,tx,d2,e2,ty,gx,gy,1-gx*cx-gy*cy]);
}

function reduceLevel(level){
  const w=Math.ceil(level.w/2),h=Math.ceil(level.h/2);
  const pass=src=>{
    const tmp=new Float32Array(w*level.h),out=new Float32Array(w*h);
    for(let y=0;y<level.h;y++)for(let x=0;x<w;x++){let s=0;for(let k=0;k<5;k++)s+=K[k]*src[y*level.w+Math.max(0,Math.min(level.w-1,2*x+k-2))];tmp[y*w+x]=s;}
    for(let y=0;y<h;y++)for(let k=0;k<5;k++){const sy=Math.max(0,Math.min(level.h-1,2*y+k-2));for(let x=0;x<w;x++)out[y*w+x]+=K[k]*tmp[sy*w+x];}
    return out;
  };
  const luma=pass(level.luma);
  const valid=level.valid?pass(Float32Array.from(level.valid,v=>v?1:0)).map(c=>c>0.5):null;
  return {luma,valid,w,h};
}

function levelsOf(plane){
  const out=[{luma:plane.luma,valid:plane.valid,w:plane.w,h:plane.h}];
  while(out.at(-1).h>64&&out.at(-1).w>8)out.push(reduceLevel(out.at(-1)));
  return out;
}

function spline4(t){return [((-1/3*t+0.8)*t-0.46666667)*t,((t-1.8)*t-0.2)*t+1,(1.2-t)*t*t+0.8*t,((1/3*t-0.2)*t-0.13333334)*t];}

function sample(src,w,h,sx,sy){
  const x0=Math.floor(sx),y0=Math.floor(sy),wx=spline4(sx-x0),wy=spline4(sy-y0);
  let acc=0;
  for(let j=0;j<4;j++){const yy=Math.max(0,Math.min(h-1,y0+j-1));let r=0;for(let i=0;i<4;i++)r+=wx[i]*src[yy*w+Math.max(0,Math.min(w-1,x0+i-1))];acc+=wy[j]*r;}
  return acc;
}

function poseCost(reference,target,v){
  const inv=poseMatrix(v,target.w,target.h).inverse();
  if(!inv)return [1e9,0,0];
  const xmax=target.w-1,ymax=target.h-1,m=inv.m,affine=m[6]===0&&m[7]===0&&m[8]===1;
  let sr=0,st=0,sr2=0,st2=0,srt=0,cnt=0;
  for(let y=0;y<reference.h;y++){
    const x0=affine?m[1]*y+m[2]:0,y0=affine?m[4]*y+m[5]:0,dx=m[0],dy=m[3];
    for(let x=0;x<reference.w;x++){
      if(reference.valid&&!reference.valid[y*reference.w+x])continue;
      const sx=affine?x0+dx*x:inv.apply(x,y)[0],sy=affine?y0+dy*x:inv.apply(x,y)[1];
      if(sx<0||sy<0||sx>xmax||sy>ymax)continue;
      if(target.valid&&!target.valid[Math.round(sy)*target.w+Math.round(sx)])continue;
      const r=reference.luma[y*reference.w+x],t=sample(target.luma,target.w,target.h,sx,sy);
      sr+=r;st+=t;sr2+=r*r;st2+=t*t;srt+=r*t;cnt++;
    }
  }
  if(cnt<16)return [1e9,cnt,0];
  const n=cnt,vr=Math.max(0,sr2-sr*sr/n),vt=Math.max(0,st2-st*st/n),cov=srt-sr*st/n;
  return [Math.sqrt(Math.max(0,(vr+vt-2*cov)/n)),cnt,vr>0&&vt>0?Math.max(-1,Math.min(1,cov/Math.sqrt(vr*vt))):0];
}

function nelderMead(f,x0,lo,hi,step,tol){
  const n=x0.length,clamp=v=>{for(let k=0;k<n;k++)v[k]=Math.max(lo[k],Math.min(hi[k],v[k]));};
  const simplex=[x0.slice()];
  for(let k=0;k<n;k++){const v=x0.slice();v[k]+=step[k];clamp(v);simplex.push(v);}
  const fv=simplex.map(v=>f(v));
  for(let it=0;it<200;it++){
    const idx=[...simplex.keys()].sort((a,b)=>fv[a]-fv[b]);
    const nextS=idx.map(i=>simplex[i]),nextF=idx.map(i=>fv[i]);
    simplex.splice(0,simplex.length,...nextS);fv.splice(0,fv.length,...nextF);
    const spread=Math.abs(fv[n]-fv[0])<=1e-4*(1+Math.abs(fv[0]));
    const close=simplex.slice(1).every(v=>v.every((value,k)=>Math.abs(value-simplex[0][k])<=tol[k]));
    if(spread&&close)break;
    const c=Array(n).fill(0);for(let i=0;i<n;i++)for(let k=0;k<n;k++)c[k]+=simplex[i][k]/n;
    const xr=c.map((value,k)=>value+(value-simplex[n][k]));clamp(xr);const fr=f(xr);
    if(fr<fv[0]){
      const xe=c.map((value,k)=>value+2*(xr[k]-value));clamp(xe);const fe=f(xe);
      if(fe<fr){simplex[n]=xe;fv[n]=fe;}else{simplex[n]=xr;fv[n]=fr;}
    }else if(fr<fv[n-1]){simplex[n]=xr;fv[n]=fr;}
    else{
      const xc=c.map((value,k)=>value+0.5*(simplex[n][k]-value));clamp(xc);const fc=f(xc);
      if(fc<fv[n]){simplex[n]=xc;fv[n]=fc;}
      else for(let i=1;i<=n;i++){for(let k=0;k<n;k++)simplex[i][k]=simplex[0][k]+0.5*(simplex[i][k]-simplex[0][k]);clamp(simplex[i]);fv[i]=f(simplex[i]);}
    }
  }
  let best=0;for(let i=1;i<fv.length;i++)if(fv[i]<fv[best])best=i;
  return simplex[best];
}

export function intensityHomography(vector,w,h){return poseMatrix(vector,w,h);}

export function registerIntensity(reference,target,motion){
  const free=FREE[motion]||FREE.similarity;
  const pref=levelsOf(reference),ptgt=levelsOf(target),n=Math.min(pref.length,ptgt.length);
  let cur=[0,0,1,0,1,0,0,0];
  const lo=free.map(k=>cur[k]-SPAN[k]),hi=free.map(k=>cur[k]+SPAN[k]);
  const gain=[target.w,target.h,Math.max(target.w,target.h)/2,Math.max(target.w,target.h)/2,target.h/2,target.h/2,target.w/4,target.h/4];
  let result=[1e9,0,0];
  for(let lvl=n-1;lvl>=0;lvl--){
    const snap=cur.slice();
    const f=xf=>{const v=snap.slice();free.forEach((idx,k)=>v[idx]=xf[k]);return poseCost(pref[lvl],ptgt[lvl],v)[0];};
    const px=2**Math.min(60,lvl);
    const step=free.map(k=>px/gain[k]),tol=free.map(k=>0.1*px/gain[k]);
    const best=nelderMead(f,free.map(k=>cur[k]),lo,hi,step,tol);
    free.forEach((idx,k)=>cur[idx]=best[k]);
    result=poseCost(pref[lvl],ptgt[lvl],cur);
  }
  return {vector:cur,homography:poseMatrix(cur,target.w,target.h),rms:result[0],overlap:result[1],correlation:result[2]};
}
