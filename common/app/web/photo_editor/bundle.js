// PhotoCraft panorama::align: chained motion plus Levenberg–Marquardt bundle adjustment.

import {Homography,fit} from './features.js';

class Rng{
  constructor(seed){this.state=BigInt(seed);}
  next(){this.state=(this.state+0x9E3779B97F4A7C15n)&0xFFFFFFFFFFFFFFFFn;let z=this.state;z=(z^(z>>30n))*0xBF58476D1CE4E5B9n&0xFFFFFFFFFFFFFFFFn;z=(z^(z>>27n))*0x94D049BB133111EBn&0xFFFFFFFFFFFFFFFFn;return z^(z>>31n);}
  below(n){return Number(this.next()%BigInt(Math.max(1,n)));}
}

function solveDense(n,a,b){
  a=a.slice();b=b.slice();
  for(let c=0;c<n;c++){
    let p=c;for(let i=c+1;i<n;i++)if(Math.abs(a[i*n+c])>Math.abs(a[p*n+c]))p=i;
    if(Math.abs(a[p*n+c])<1e-12)return null;
    if(p!==c){for(let k=0;k<n;k++)[a[c*n+k],a[p*n+k]]=[a[p*n+k],a[c*n+k]];[b[c],b[p]]=[b[p],b[c]];}
    for(let r=c+1;r<n;r++){const f=a[r*n+c]/a[c*n+c];for(let k=c;k<n;k++)a[r*n+k]-=f*a[c*n+k];b[r]-=f*b[c];}
  }
  const x=Array(n).fill(0);
  for(let r=n-1;r>=0;r--){let s=0;for(let k=r+1;k<n;k++)s+=a[r*n+k]*x[k];x[r]=(b[r]-s)/a[r*n+r];}
  return x;
}

const MOTION={
  translation:{min:1,n:2,params:m=>[m[2],m[5]],homography:p=>new Homography([1,0,p[0],0,1,p[1],0,0,1])},
  euclidean:{min:2,n:3,params:m=>[Math.atan2(m[3],m[0]),m[2],m[5]],homography:p=>{const c=Math.cos(p[0]),s=Math.sin(p[0]);return new Homography([c,-s,p[1],s,c,p[2],0,0,1]);}},
  similarity:{min:2,n:4,params:m=>[m[0],m[3],m[2],m[5]],homography:p=>new Homography([p[0],-p[1],p[2],p[1],p[0],p[3],0,0,1])},
  homography:{min:4,n:8,params:m=>m.slice(0,8),homography:p=>new Homography([p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],1])}
};

function layoutMotion(layout){
  if(layout==='cylindrical'||layout==='spherical')return 'euclidean';
  if(layout==='collage')return 'similarity';
  if(layout==='reposition')return 'translation';
  return 'homography';
}
function layoutProjection(layout){return layout==='cylindrical'?'cylinder':layout==='spherical'?'sphere':'plane';}

function fitMotion(motion,src,dst){
  if(motion!=='euclidean')return fit(motion==='translation'?'translation':motion,src,dst);
  if(src.length<2)return null;
  const n=src.length;let cs=[0,0],cd=[0,0];
  for(let i=0;i<n;i++){cs[0]+=src[i][0]/n;cs[1]+=src[i][1]/n;cd[0]+=dst[i][0]/n;cd[1]+=dst[i][1]/n;}
  let sxx=0,sxy=0;
  for(let i=0;i<n;i++){const a=[src[i][0]-cs[0],src[i][1]-cs[1]],b=[dst[i][0]-cd[0],dst[i][1]-cd[1]];sxx+=a[0]*b[0]+a[1]*b[1];sxy+=a[0]*b[1]-a[1]*b[0];}
  const th=Math.atan2(sxy,sxx),c=Math.cos(th),s=Math.sin(th);
  return new Homography([c,-s,cd[0]-(c*cs[0]-s*cs[1]),s,c,cd[1]-(s*cs[0]+c*cs[1]),0,0,1]);
}

function ransacMotion(motion,src,dst,iters,threshold,seed){
  const spec=MOTION[motion],k=spec.min,n=src.length;
  if(n<k)return null;
  const rng=new Rng(BigInt(seed)^0x5EED0FA1n);
  const inliersOf=h=>{const out=[];for(let i=0;i<n;i++){const [x,y]=h.apply(src[i][0],src[i][1]);if(Number.isFinite(x)&&Math.hypot(x-dst[i][0],y-dst[i][1])<=threshold)out.push(i);}return out;};
  let best=null;
  for(let t=0;t<Math.max(1,iters);t++){
    const idx=n===k?[...Array(k).keys()]:[];
    while(idx.length<k){const i=rng.below(n);if(!idx.includes(i))idx.push(i);}
    const h=fitMotion(motion,idx.map(i=>src[i]),idx.map(i=>dst[i]));if(!h)continue;
    const inl=inliersOf(h);if(!best||inl.length>best[1].length)best=[h,inl];
  }
  if(!best||best[1].length<k)return null;
  const h2=fitMotion(motion,best[1].map(i=>src[i]),best[1].map(i=>dst[i]))||best[0],inl2=inliersOf(h2);
  return inl2.length>=best[1].length?[h2,inl2]:best;
}

export class Placement{
  constructor(projection,focal,center,k1,h){this.projection=projection;this.focal=focal;this.center=center;this.k1=k1;this.h=h;}
  project(x,y){
    let dx=x-this.center[0],dy=y-this.center[1];
    if(this.k1){const s=1+this.k1*(dx*dx+dy*dy)/(this.focal*this.focal);dx*=s;dy*=s;}
    const f=this.focal;
    if(this.projection==='cylinder')return [f*Math.atan2(dx,f),f*dy/Math.hypot(dx,f)];
    if(this.projection==='sphere')return [f*Math.atan2(dx,f),f*Math.atan2(dy,Math.hypot(dx,f))];
    return [dx,dy];
  }
  unproject(a,b){
    const f=this.focal;let dx,dy;
    if(this.projection==='cylinder'){const th=a/f;if(Math.abs(th)>=1.55)return null;dx=f*Math.tan(th);dy=b/Math.cos(th);}
    else if(this.projection==='sphere'){const th=a/f,ph=b/f;if(Math.abs(th)>=1.55||Math.abs(ph)>=1.55)return null;dx=f*Math.tan(th);dy=f*Math.tan(ph)/Math.cos(th);}
    else {dx=a;dy=b;}
    if(this.k1){const ru=Math.hypot(dx,dy);if(ru>1e-9){let rd=ru;for(let i=0;i<8;i++){const g=rd*(1+this.k1*rd*rd/(f*f))-ru,dg=1+3*this.k1*rd*rd/(f*f);if(Math.abs(dg)<1e-9)break;rd-=g/dg;}if(!Number.isFinite(rd)||rd<=0)return null;dx*=rd/ru;dy*=rd/ru;}}
    return [dx+this.center[0],dy+this.center[1]];
  }
  forward(x,y){const p=this.project(x,y);return this.h.apply(p[0],p[1]);}
  inverse(u,v){const inv=this.h.inverse();if(!inv)return null;const m=inv.m,w=m[6]*u+m[7]*v+m[8];if(w<=1e-12)return null;const [a,b]=inv.apply(u,v);return this.unproject(a,b);}
  scaled(k){
    const s=new Homography([k,0,0,0,k,0,0,0,1]),si=new Homography([1/k,0,0,0,1/k,0,0,0,1]);
    return new Placement(this.projection,this.focal*k,[this.center[0]*k,this.center[1]*k],this.k1,s.mul(this.h).mul(si));
  }
  bounds(w,h){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(let i=0;i<=32;i++){const t=i/32;for(const [x,y] of [[t*w,0],[t*w,h],[0,t*h],[w,t*h]]){const [u,v]=this.forward(x,y);if(Number.isFinite(u)&&Number.isFinite(v)){x0=Math.min(x0,u);y0=Math.min(y0,v);x1=Math.max(x1,u);y1=Math.max(y1,v);}}}
    return [x0,y0,x1,y1];
  }
}

function basePlacement(feat,projection,focal,k1){return new Placement(projection,focal,[feat.w/2,feat.h/2],k1,new Homography([1,0,0,0,1,0,0,0,1]));}

function tooStretched(feats,alignment){
  let x0=Infinity,x1=-Infinity;
  for(let i=0;i<feats.length;i++){
    const p=alignment.placements[i];if(!p)continue;
    const w=feats[i].w,h=feats[i].h,c=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>p.forward(x,y));
    let area=0;for(let k=0;k<4;k++)area+=c[k][0]*c[(k+1)%4][1]-c[(k+1)%4][0]*c[k][1];area/=2;
    const ratio=area/(w*h);
    if(!Number.isFinite(ratio)||ratio<0.3||ratio>3)return true;
    const m=p.h.m;
    for(const [x,y] of [[0,0],[w,0],[w,h],[0,h]]){const q=p.project(x,y);if(m[6]*q[0]+m[7]*q[1]+m[8]<=0)return true;}
    for(const [u] of c){x0=Math.min(x0,u);x1=Math.max(x1,u);}
  }
  return 2*Math.atan((x1-x0)/2/alignment.focal)>110*Math.PI/180;
}

function alignLayout(feats,matches,reference,layout,focal,geometric){
  const n=feats.length,projection=layoutProjection(layout),motion=layoutMotion(layout),spec=MOTION[motion];
  const pairs=[],edges=[];
  for(const m of matches){
    const pa=basePlacement(feats[m.a],projection,focal,0),pb=basePlacement(feats[m.b],projection,focal,0);
    const qa=m.ptsA.map(p=>pa.project(p[0],p[1])),qb=m.ptsB.map(p=>pb.project(p[0],p[1]));
    const thr=Math.max(2,Math.min(5,Math.max(feats[m.a].w,feats[m.a].h)/250));
    const fit=ransacMotion(motion,qb,qa,600,thr,m.a*977+m.b);
    if(!fit||fit[1].length<8||fit[1].length<0.5*m.ptsA.length)continue;
    edges.push({a:m.a,b:m.b,n:fit[1].length,h:fit[0]});
    const step=Math.max(1,Math.ceil(fit[1].length/80)),sel=fit[1].filter((_,i)=>i%step===0);
    pairs.push({a:m.a,b:m.b,pa:sel.map(i=>m.ptsA[i]),pb:sel.map(i=>m.ptsB[i])});
  }
  if(!edges.length)return null;
  const degree=Array(n).fill(0);for(const e of edges){degree[e.a]+=e.n;degree[e.b]+=e.n;}
  if(reference==null||reference>=n)reference=[...Array(n).keys()].sort((i,j)=>degree[j]-degree[i]||Math.abs(i-n/2)-Math.abs(j-n/2))[0];
  const tf=Array(n).fill(null);
  const rc=[feats[reference].w/2,feats[reference].h/2];
  tf[reference]=new Homography([1,0,rc[0],0,1,rc[1],0,0,1]);
  for(;;){
    let best=null;
    for(const e of edges){
      let cand=null;
      if(tf[e.a]&&!tf[e.b])cand=[e.b,tf[e.a].mul(e.h)];
      else if(!tf[e.a]&&tf[e.b]){const inv=e.h.inverse();if(inv)cand=[e.a,tf[e.b].mul(inv)];}
      if(cand&&(!best||e.n>best[1]))best=[cand[0],e.n,cand[1]];
    }
    if(!best)break;tf[best[0]]=best[2];
  }
  const placed=[...Array(n).keys()].filter(i=>tf[i]);
  if(placed.length<2)return null;
  const movable=placed.filter(i=>i!==reference),mp=spec.n,refine=projection!=='plane';
  let params=[];
  for(const i of movable)params.push(...spec.params(tf[i].m.map(v=>v/(tf[i].m[8]||1))));
  if(geometric)params.push(0);
  if(refine)params.push(Math.log(focal));
  const nPar=params.length,nGlob=(geometric?1:0)+(refine?1:0);
  const decode=p=>{
    const k1=geometric?p[movable.length*mp]:0,f=refine?Math.exp(p[nPar-1]):focal;
    return feats.map((feat,i)=>{
      let h=tf[reference];
      if(i!==reference){const k=movable.indexOf(i);if(k<0)return null;h=spec.homography(p.slice(k*mp,(k+1)*mp));}
      return new Placement(projection,f,[feat.w/2,feat.h/2],k1,h);
    });
  };
  const residuals=p=>{
    const pl=decode(p),r=[];
    for(const pd of pairs){const a=pl[pd.a],b=pl[pd.b];if(!a||!b)continue;for(let i=0;i<pd.pa.length;i++){const A=a.forward(pd.pa[i][0],pd.pa[i][1]),B=b.forward(pd.pb[i][0],pd.pb[i][1]);r.push(A[0]-B[0],A[1]-B[1]);}}
    if(geometric)r.push(p[movable.length*mp]*20);
    if(refine)r.push((p[nPar-1]-Math.log(focal))*2);
    return r;
  };
  const cost=r=>r.reduce((s,v)=>s+v*v,0);
  let cur=residuals(params),lambda=1e-3;
  if(nPar>0&&movable.length){
    for(let iter=0;iter<40;iter++){
      const cols=[];
      for(let j=0;j<nPar;j++){
        const step=1e-6*(1+Math.abs(params[j])),pp=params.slice();pp[j]+=step;const rp=residuals(pp);pp[j]-=2*step;const rm=residuals(pp);
        cols.push(rp.map((v,i)=>(v-rm[i])/(2*step)));
      }
      const jtj=Array(nPar*nPar).fill(0),jtr=Array(nPar).fill(0);
      for(let a=0;a<nPar;a++){jtr[a]=-cols[a].reduce((s,j,i)=>s+j*cur[i],0);for(let b=a;b<nPar;b++){let v=0;for(let i=0;i<cols[a].length;i++)v+=cols[a][i]*cols[b][i];jtj[a*nPar+b]=jtj[b*nPar+a]=v;}}
      let improved=false;
      for(let inner=0;inner<8;inner++){
        const a=jtj.slice();for(let d=0;d<nPar;d++)a[d*nPar+d]+=lambda*(jtj[d*nPar+d]+1e-9);
        const delta=solveDense(nPar,a,jtr);if(!delta){lambda*=10;continue;}
        const trial=params.map((v,i)=>v+delta[i]),rt=residuals(trial);
        if(cost(rt)<cost(cur)){const gain=cost(cur)-cost(rt);params=trial;cur=rt;lambda=Math.max(1e-9,lambda*0.3);improved=gain>1e-10*Math.max(cost(cur),1e-12);break;}
        lambda*=10;
      }
      if(!improved)break;
    }
  }
  const placements=decode(params);
  const nRes=Math.max(1,pairs.reduce((s,p)=>s+p.pa.length,0));
  const rms=Math.sqrt(cost(cur.slice(0,Math.max(0,cur.length-nGlob)))/nRes);
  return {layout,reference,placements,focal:refine?Math.exp(params[nPar-1]):focal,k1:geometric?params[movable.length*mp]:0,rms};
}

export function alignImages(feats,matches,layout,focal,reference,geometric){
  if(feats.length<2||!matches.length)return null;
  let f=focal;
  if(!(f>1)){
    const side=Math.max(...feats.map(feat=>Math.max(feat.w,feat.h)));
    const fs=matches.map(m=>focalFrom(m.homography,feats[m.a],feats[m.b])).filter(v=>Number.isFinite(v)&&v>side*0.2&&v<side*20).sort((a,b)=>a-b);
    f=fs.length?fs[fs.length>>1]:side;
  }
  if(layout!=='auto')return alignLayout(feats,matches,reference,layout,f,geometric);
  const perspective=alignLayout(feats,matches,reference,'perspective',f,geometric);
  if(perspective&&!tooStretched(feats,perspective))return perspective;
  const cyl=alignLayout(feats,matches,reference,'cylindrical',f,geometric);
  if(!cyl)return null;
  let y0=Infinity,y1=-Infinity;
  cyl.placements.forEach((p,i)=>{if(!p)return;const b=p.bounds(feats[i].w,feats[i].h);y0=Math.min(y0,b[1]);y1=Math.max(y1,b[3]);});
  if((y1-y0)/cyl.focal>1.4)return alignLayout(feats,matches,reference,'spherical',cyl.focal,geometric);
  return cyl;
}

function focalFrom(h,fa,fb){
  const ca=[fa.w/2,fa.h/2],cb=[fb.w/2,fb.h/2];
  const ta=new Homography([1,0,-ca[0],0,1,-ca[1],0,0,1]),tb=new Homography([1,0,cb[0],0,1,cb[1],0,0,1]);
  const m=ta.mul(h).mul(tb).m;
  const pick=(c1,c2)=>{const ok=([n,d])=>Math.abs(d)>1e-12&&n/d>0?[n/d,Math.abs(d)]:null;const a=ok(c1),b=ok(c2);if(a&&b)return a[1]>=b[1]?a[0]:b[0];return (a||b)?.[0]??null;};
  const f1=pick([-(m[0]*m[1]+m[3]*m[4]),m[6]*m[7]],[m[1]*m[1]+m[4]*m[4]-m[0]*m[0]-m[3]*m[3],m[6]*m[6]-m[7]*m[7]]);
  const f0=pick([-(m[2]*m[5]),m[0]*m[3]+m[1]*m[4]],[m[5]*m[5]-m[2]*m[2],m[0]*m[0]+m[1]*m[1]-m[3]*m[3]-m[4]*m[4]]);
  if(f0!=null&&f1!=null)return Math.sqrt(Math.sqrt(f0*f1));
  if(f0!=null)return Math.sqrt(f0);
  if(f1!=null)return Math.sqrt(f1);
  return null;
}
