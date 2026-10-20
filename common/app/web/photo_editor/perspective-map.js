// PhotoCraft crates/algo/src/perspective.rs: linked corners, straighten, PerspectiveMap.

import {quadMapping} from './perspective.js';
import {Homography} from './features.js';

const LINK_EPS=0.5;
const UNIT=[[0,0],[1,0],[1,1],[0,1]];

function asH(from,to){
  try{return new Homography([...quadMapping(from.map(([x,y])=>({x,y})),to.map(([x,y])=>({x,y}))),1]);}
  catch{return null;}
}

export function linkedCorners(planes){
  const groups=[];
  planes.forEach((plane,pi)=>plane.src.forEach((c,ci)=>{
    const group=groups.find(g=>{const [a,b]=g[0],o=planes[a].src[b];return Math.abs(o[0]-c[0])<=LINK_EPS&&Math.abs(o[1]-c[1])<=LINK_EPS;});
    if(group)group.push([pi,ci]);else groups.push([[pi,ci]]);
  }));
  return groups;
}

export function unify(planes){
  for(const group of linkedCorners(planes)){
    if(group.length<2)continue;
    const n=group.length;
    const s=[0,0],d=[0,0];
    for(const [p,c] of group){s[0]+=planes[p].src[c][0]/n;s[1]+=planes[p].src[c][1]/n;d[0]+=planes[p].dst[c][0]/n;d[1]+=planes[p].dst[c][1]/n;}
    for(const [p,c] of group){planes[p].src[c]=s.slice();planes[p].dst[c]=d.slice();}
  }
}

export function straightenPlanes(planes,mode){
  unify(planes);
  const groups=linkedCorners(planes);
  const groupOf=(p,c)=>groups.findIndex(g=>g.some(item=>item[0]===p&&item[1]===c));
  const pos=groups.map(g=>planes[g[0][0]].dst[g[0][1]].slice());
  for(let p=0;p<planes.length;p++)for(let k=0;k<4;k++){
    const a=Math.max(0,groupOf(p,k)),b=Math.max(0,groupOf(p,(k+1)%4));
    const pa=pos[a],pb=pos[b],dx=Math.abs(pb[0]-pa[0]),dy=Math.abs(pb[1]-pa[1]);
    if(dy<=dx&&(mode==='horizontal'||mode==='auto')){const y=(pa[1]+pb[1])/2;pa[1]=pb[1]=y;}
    else if(dx<dy&&(mode==='vertical'||mode==='auto')){const x=(pa[0]+pb[0])/2;pa[0]=pb[0]=x;}
  }
  groups.forEach((group,i)=>{for(const [pi,ci] of group)planes[pi].dst[ci]=pos[i].slice();});
}

function edgeUv(k,u,v){
  if(k===0)return [[u,0],1-v];
  if(k===1)return [[1,v],u];
  if(k===2)return [[u,1],v];
  return [[0,v],1-u];
}

function distToQuad(q,p){
  let best=Infinity;
  for(let k=0;k<4;k++){
    const a=q[k],b=q[(k+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
    const t=l2>0?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)):0;
    best=Math.min(best,Math.hypot(a[0]+t*dx-p[0],a[1]+t*dy-p[1]));
  }
  return best;
}

export function perspectiveForward(planes){
  if(!planes.length)return null;
  const copy=planes.map(plane=>({src:plane.src.map(p=>p.slice()),dst:plane.dst.map(p=>p.slice())}));
  unify(copy);
  const near=(a,b)=>Math.abs(a[0]-b[0])<=LINK_EPS&&Math.abs(a[1]-b[1])<=LINK_EPS;
  const maps=[];
  for(let i=0;i<copy.length;i++){
    const p=copy[i],src=asH(UNIT,p.src),dst=asH(UNIT,p.dst);
    if(!src||!dst)return null;
    const srcInv=src.inverse();
    if(!srcInv)return null;
    const shared=[null,null,null,null];
    for(let k=0;k<4;k++){
      const a=p.src[k],b=p.src[(k+1)%4];
      const found=copy.findIndex((o,j)=>j!==i&&[0,1,2,3].some(m=>{const c=o.src[m],d=o.src[(m+1)%4];return near(a,c)&&near(b,d)||near(a,d)&&near(b,c);}));
      shared[k]=found>=0?found:null;
    }
    maps.push({src,srcInv,dst,quad:p.src,shared});
  }
  const locate=(x,y)=>{
    let best=[0,Infinity,0,0];
    for(let i=0;i<maps.length;i++){
      const [u,v]=maps[i].srcInv.apply(x,y);
      if(u>=-1e-9&&u<=1+1e-9&&v>=-1e-9&&v<=1+1e-9)return [i,u,v];
      const d=distToQuad(maps[i].quad,[x,y]);
      if(d<best[1])best=[i,d,u,v];
    }
    return [best[0],best[2],best[3]];
  };
  return (x,y)=>{
    const [i,u,v]=locate(x,y),pm=maps[i];
    let [ox,oy]=pm.dst.apply(u,v);
    if(!Number.isFinite(ox)||!Number.isFinite(oy))return [x,y];
    const cu=Math.max(0,Math.min(1,u)),cv=Math.max(0,Math.min(1,v));
    pm.shared.forEach((j,k)=>{
      if(j==null)return;
      const [e,w]=edgeUv(k,cu,cv);
      if(w<=0)return;
      const mine=pm.dst.apply(e[0],e[1]);
      const [qx,qy]=pm.src.apply(e[0],e[1]);
      const other=maps[j];
      const [ou,ov]=other.srcInv.apply(qx,qy);
      const theirs=other.dst.apply(ou,ov);
      ox+=w*(((mine[0]+theirs[0])/2)-mine[0]);
      oy+=w*(((mine[1]+theirs[1])/2)-mine[1]);
    });
    return [ox,oy];
  };
}
