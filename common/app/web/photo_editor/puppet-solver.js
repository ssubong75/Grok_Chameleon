// PhotoCraft crates/algo/src/puppet.rs: cotangent ARAP, density, expansion, Rigid / Normal / Distort.

import {buildPuppetMesh} from './puppet-mesh.js';

function cot(a,b,c){
  const u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-a[0],c[1]-a[1]],cross=Math.abs(u[0]*v[1]-u[1]*v[0]);
  return cross<1e-12?0:(u[0]*v[0]+u[1]*v[1])/cross;
}

function locate(mesh,p){
  for(const t of mesh.tris){
    const [a,b,c]=t.map(i=>mesh.verts[i]);
    const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    if(Math.abs(det)<1e-12)continue;
    const l1=((p[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(p[1]-a[1]))/det;
    const l2=((b[0]-a[0])*(p[1]-a[1])-(p[0]-a[0])*(b[1]-a[1]))/det;
    const l0=1-l1-l2;
    if(l0>=-1e-9&&l1>=-1e-9&&l2>=-1e-9)return {verts:t,bary:[l0,l1,l2]};
  }
  let i=0,best=Infinity;
  mesh.verts.forEach((v,index)=>{const d=(v[0]-p[0])**2+(v[1]-p[1])**2;if(d<best){best=d;i=index;}});
  return {verts:[i,i,i],bary:[1,0,0]};
}

export function meshFromCanvas(canvas,density,expansion){return buildPuppetMesh(canvas,density,expansion);}

function csr(n,trips){
  const rows=Array.from({length:n},()=>new Map());
  for(const [i,j,v] of trips)rows[i].set(j,(rows[i].get(j)||0)+v);
  return rows.map(row=>[...row].filter(([,v])=>Math.abs(v)>1e-15).sort((a,b)=>a[0]-b[0]));
}

function cg(rows,diag,b,x){
  const n=b.length,r=new Float64Array(n),z=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);
  const mul=v=>{ap.fill(0);for(let i=0;i<n;i++)for(const [j,w] of rows[i])ap[i]+=w*v[j];};
  mul(x);for(let i=0;i<n;i++)r[i]=b[i]-ap[i];
  for(let i=0;i<n;i++)z[i]=r[i]/diag[i];p.set(z);
  let rz=0;for(let i=0;i<n;i++)rz+=r[i]*z[i];
  const tol=1e-10*Math.max(1,rz);
  for(let it=0;it<Math.min(400,n)&&rz>tol;it++){
    mul(p);let pap=0;for(let i=0;i<n;i++)pap+=p[i]*ap[i];if(Math.abs(pap)<1e-18)break;
    const alpha=rz/pap;
    for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/diag[i];}
    let next=0;for(let i=0;i<n;i++)next+=r[i]*z[i];
    const beta=next/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=next;
  }
}

export function solveArap(mesh,pins,mode){
  const nv=mesh.verts.length,w=mesh.tris.map(t=>{const [a,b,c]=t.map(i=>mesh.verts[i]);return [0.5*cot(a,b,c),0.5*cot(b,c,a),0.5*cot(c,a,b)];});
  const bound=pins.map(pin=>locate(mesh,pin.src));
  const parent=Array.from({length:nv},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const t of mesh.tris)for(let k=1;k<3;k++){const a=find(t[0]),b=find(t[k]);if(a!==b)parent[a]=b;}
  const pinned=Array(nv).fill(false);
  for(const b of bound)for(const v of b.verts)pinned[find(v)]=true;
  const anchored=Array.from({length:nv},(_,v)=>!pinned[find(v)]);
  const pinTris=bound.map((b,k)=>{
    if(!pins[k].rotation)return [];
    let v=b.verts[0],best=Infinity;for(const i of b.verts){const d=(mesh.verts[i][0]-pins[k].src[0])**2+(mesh.verts[i][1]-pins[k].src[1])**2;if(d<best){best=d;v=i;}}
    return mesh.tris.map((t,i)=>t.includes(v)?i:-1).filter(i=>i>=0);
  });
  const trips=[];let diagSum=0;
  mesh.tris.forEach((t,ti)=>{for(let k=0;k<3;k++){const i=t[(k+1)%3],j=t[(k+2)%3],wk=w[ti][k];trips.push([i,i,wk],[j,j,wk],[i,j,-wk],[j,i,-wk]);diagSum+=2*wk;}});
  const pinWeight=1e4*Math.max(1,diagSum/Math.max(1,nv));
  for(const b of bound)for(let a=0;a<3;a++)for(let c=0;c<3;c++)trips.push([b.verts[a],b.verts[c],pinWeight*b.bary[a]*b.bary[c]]);
  anchored.forEach((an,v)=>{if(an)trips.push([v,v,pinWeight]);});
  const rows=csr(nv,trips),diag=Float64Array.from({length:nv},(_,i)=>rows[i].find(([j])=>j===i)?.[1]||1);
  let pos=mesh.verts.map(p=>p.slice());
  for(let pass=0;pass<40;pass++){
    const rots=mesh.tris.map((t,ti)=>{
      const s=[0,0,0,0];let norm=0;
      for(let k=0;k<3;k++){const i=t[(k+1)%3],j=t[(k+2)%3],d=[pos[i][0]-pos[j][0],pos[i][1]-pos[j][1]],e=[mesh.verts[i][0]-mesh.verts[j][0],mesh.verts[i][1]-mesh.verts[j][1]],wk=w[ti][k];s[0]+=wk*d[0]*e[0];s[1]+=wk*d[0]*e[1];s[2]+=wk*d[1]*e[0];s[3]+=wk*d[1]*e[1];norm+=wk*(e[0]*e[0]+e[1]*e[1]);}
      const c=s[0]+s[3],sn=s[2]-s[1],th=Math.atan2(sn,c);
      let scale=mode==='rigid'?1:mode==='distort'?Math.hypot(c,sn)/Math.max(1e-12,norm):Math.sqrt(Math.hypot(c,sn)/Math.max(1e-12,norm));
      if(!Number.isFinite(scale)||scale<=0)scale=1;
      return [scale*Math.cos(th),-scale*Math.sin(th),scale*Math.sin(th),scale*Math.cos(th)];
    });
    pinTris.forEach((tris,k)=>{if(!pins[k].rotation)return;const rad=pins[k].rotation*Math.PI/180,s=Math.sin(rad),c=Math.cos(rad);for(const t of tris)rots[t]=[c,-s,s,c];});
    const bx=new Float64Array(nv),by=new Float64Array(nv);
    mesh.tris.forEach((t,ti)=>{const r=rots[ti];for(let k=0;k<3;k++){const i=t[(k+1)%3],j=t[(k+2)%3],e=[mesh.verts[i][0]-mesh.verts[j][0],mesh.verts[i][1]-mesh.verts[j][1]],re=[r[0]*e[0]+r[1]*e[1],r[2]*e[0]+r[3]*e[1]],wk=w[ti][k];bx[i]+=wk*re[0];by[i]+=wk*re[1];bx[j]-=wk*re[0];by[j]-=wk*re[1];}});
    bound.forEach((b,i)=>{for(let k=0;k<3;k++){bx[b.verts[k]]+=pinWeight*b.bary[k]*pins[i].dst[0];by[b.verts[k]]+=pinWeight*b.bary[k]*pins[i].dst[1];}});
    anchored.forEach((an,i)=>{if(an){bx[i]+=pinWeight*mesh.verts[i][0];by[i]+=pinWeight*mesh.verts[i][1];}});
    const sx=Float64Array.from(pos,p=>p[0]),sy=Float64Array.from(pos,p=>p[1]);
    cg(rows,diag,bx,sx);cg(rows,diag,by,sy);
    pos=Array.from({length:nv},(_,i)=>[sx[i],sy[i]]);
  }
  return pos;
}
