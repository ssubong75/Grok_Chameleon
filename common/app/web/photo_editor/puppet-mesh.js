// PhotoCraft crates/algo/src/puppet.rs build_mesh: signed distance, marching squares, Delaunay.

const ALPHA_MIN=0.05,FIELD_BLOCKS=1024,MAX_OUTLINE=20000,NONE=-1;
const CELLS={fewer:12,normal:20,more:32};

function dist2(a,b){return (a[0]-b[0])**2+(a[1]-b[1])**2;}
function lerp(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}
function orient(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function inCircle(a,b,c,d){
  const ax=a[0]-d[0],ay=a[1]-d[1],bx=b[0]-d[0],by=b[1]-d[1],cx=c[0]-d[0],cy=c[1]-d[1];
  return (ax*ax+ay*ay)*(bx*cy-cx*by)-(bx*bx+by*by)*(ax*cy-cx*ay)+(cx*cx+cy*cy)*(ax*by-bx*ay);
}
function segDist(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  const t=l2>0?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)):0;
  return Math.hypot(p[0]-(a[0]+dx*t),p[1]-(a[1]+dy*t));
}

function edt1d(f,out,v,z){
  const n=f.length;if(!n)return;
  let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
  const meet=(q,p)=>((f[q]+q*q)-(f[p]+p*p))/(2*(q-p));
  for(let q=1;q<n;q++){
    let s=meet(q,v[k]);
    while(k>0&&s<=z[k]){k--;s=meet(q,v[k]);}
    k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
  }
  k=0;
  for(let q=0;q<n;q++){while(z[k+1]<q)k++;const p=v[k];out[q]=(q-p)**2+f[p];}
}

function edt(mask,site,w,h){
  const FAR=1e20,d=Float64Array.from(mask,m=>m===site?0:FAR);
  const m=Math.max(w,h),f=new Float64Array(m),out=new Float64Array(m),v=new Uint32Array(m),z=new Float64Array(m+1);
  for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=d[y*w+x];edt1d(f.subarray(0,h),out.subarray(0,h),v,z);for(let y=0;y<h;y++)d[y*w+x]=out[y];}
  for(let y=0;y<h;y++){f.set(d.subarray(y*w,y*w+w));edt1d(f.subarray(0,w),d.subarray(y*w,y*w+w),v,z);}
  return d;
}

function fieldFromCanvas(canvas,expansion){
  const w=canvas.width,h=canvas.height,data=canvas.getContext('2d').getImageData(0,0,w,h).data;
  const grow=Math.ceil(Math.max(0,expansion));
  const g=Math.max(1,Math.ceil((Math.max(w,h)+2*grow+8)/FIELD_BLOCKS));
  const x0=-grow-2*g,y0=-grow-2*g,x1=w+grow+2*g,y1=h+grow+2*g;
  const bw=Math.max(1,Math.ceil((x1-x0)/g)),bh=Math.max(1,Math.ceil((y1-y0)/g));
  const cov=new Uint8Array(bw*bh);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]/255>ALPHA_MIN){const bx=Math.floor((x-x0)/g),by=Math.floor((y-y0)/g);if(bx>=0&&by>=0&&bx<bw&&by<bh)cov[by*bw+bx]=1;}
  const outside=edt(cov,true,bw,bh),inside=edt(cov,false,bw,bh),sd=new Float32Array(bw*bh);
  for(let i=0;i<cov.length;i++)sd[i]=cov[i]?-(Math.sqrt(inside[i])-0.5)*g:(Math.sqrt(outside[i])-0.5)*g;
  const at=(bx,by)=>bx<0||by<0||bx>=bw||by>=bh?1e20:sd[by*bw+bx]-expansion;
  const value=p=>{
    const fx=Math.max(0,Math.min(bw-1,(p[0]-x0)/g-0.5)),fy=Math.max(0,Math.min(bh-1,(p[1]-y0)/g-0.5));
    const ix=Math.floor(fx),iy=Math.floor(fy),ix1=Math.min(bw-1,ix+1),iy1=Math.min(bh-1,iy+1),tx=fx-ix,ty=fy-iy;
    const top=at(ix,iy)*(1-tx)+at(ix1,iy)*tx,bottom=at(ix,iy1)*(1-tx)+at(ix1,iy1)*tx;
    return top*(1-ty)+bottom*ty;
  };
  return {x0,y0,g,bw,bh,at,value};
}

function outline(field){
  const {bw,bh,at,x0,y0,g}=field;
  if(bw<2||bh<2)return [];
  const inside=(x,y)=>at(x,y)<0;
  const id=(x,y,down)=>2*(y*bw+x)+(down?1:0);
  const point=edge=>{
    const b=Math.floor(edge/2),x=b%bw,y=Math.floor(b/bw),down=edge%2;
    const x2=down?x:x+1,y2=down?y+1:y,fa=at(x,y),fb=at(x2,y2);
    const t=Math.abs(fa-fb)>1e-12?Math.max(0,Math.min(1,fa/(fa-fb))):0.5;
    return [x0+(x+0.5+(x2-x)*t)*g,y0+(y+0.5+(y2-y)*t)*g];
  };
  const links=new Map();
  const link=(a,b)=>{for(const [p,q] of [[a,b],[b,a]]){const e=links.get(p)||[-1,-1];if(e[0]<0)e[0]=q;else e[1]=q;links.set(p,e);}};
  for(let y=0;y<bh-1;y++)for(let x=0;x<bw-1;x++){
    const c=[inside(x,y),inside(x+1,y),inside(x+1,y+1),inside(x,y+1)];
    if(c.every(v=>v===c[0]))continue;
    const edges=[id(x,y,false),id(x+1,y,true),id(x,y+1,false),id(x,y,true)];
    const cross=[c[0]!==c[1],c[1]!==c[2],c[3]!==c[2],c[0]!==c[3]];
    const ks=cross.map((v,i)=>v?i:-1).filter(i=>i>=0);
    if(ks.length===2)link(edges[ks[0]],edges[ks[1]]);
    else if(ks.length===4){
      const centre=at(x,y)+at(x+1,y)+at(x+1,y+1)+at(x,y+1)<0;
      if(c[0]===centre){link(edges[0],edges[1]);link(edges[2],edges[3]);}
      else{link(edges[3],edges[0]);link(edges[1],edges[2]);}
    }
  }
  const seen=new Set(),loops=[];
  for(const start of [...links.keys()].sort((a,b)=>a-b)){
    if(seen.has(start))continue;
    const lp=[];let prev=-1,cur=start;
    for(;;){
      seen.add(cur);lp.push(point(cur));
      const pair=links.get(cur);if(!pair)break;
      const next=pair[0]!==prev?pair[0]:pair[1];
      if(next<0||seen.has(next))break;
      prev=cur;cur=next;
    }
    if(lp.length>=3)loops.push(lp);
  }
  return loops;
}

function simplify(lp,tol){
  const n=lp.length;if(n<4)return lp.slice();
  let far=1,best=dist2(lp[0],lp[1]);
  for(let i=2;i<n;i++){const d=dist2(lp[0],lp[i]);if(d>best){best=d;far=i;}}
  const keep=Array(n).fill(false);keep[0]=keep[far]=true;
  const stack=[[0,far],[far,n]];
  while(stack.length){
    const [a,b]=stack.pop(),pa=lp[a],pb=lp[b%n];
    let bd=0,bi=0;
    for(let i=a+1;i<b;i++){const d=segDist(lp[i],pa,pb);if(d>bd){bd=d;bi=i;}}
    if(bd>tol){keep[bi]=true;stack.push([a,bi],[bi,b]);}
  }
  const out=lp.filter((_,i)=>keep[i]);
  return out.length>=3?out:lp.filter((_,i)=>i%(Math.max(1,Math.floor(n/4)))===0);
}

function densify(lp,step){
  const out=[];
  for(let k=0;k<lp.length;k++){
    const a=lp[k],b=lp[(k+1)%lp.length],parts=Math.max(1,Math.min(1e4,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step)));
    for(let i=0;i<parts;i++)out.push(lerp(a,b,i/parts));
  }
  return out;
}

class Delaunay{
  constructor(lo,hi){
    const cx=(lo[0]+hi[0])/2,cy=(lo[1]+hi[1])/2,d=Math.max(1,hi[0]-lo[0],hi[1]-lo[1])*4;
    const pts=[[cx-2*d,cy-d],[cx+2*d,cy-d],[cx,cy+2*d]];
    if(orient(pts[0],pts[1],pts[2])<0)[pts[1],pts[2]]=[pts[2],pts[1]];
    this.pts=pts;this.tris=[{v:[0,1,2],n:[NONE,NONE,NONE],alive:true}];this.stamp=[0];this.pass=0;this.last=0;
  }
  locate(p){
    let t=this.tris[this.last]?.alive?this.last:this.tris.findIndex(tri=>tri.alive);
    if(t<0)return null;
    for(let n=0;n<this.tris.length+3;n++){
      const tri=this.tris[t];if(!tri)return null;
      let step=-1;
      for(let k=0;k<3;k++)if(orient(this.pts[tri.v[(k+1)%3]],this.pts[tri.v[(k+2)%3]],p)<0){step=k;break;}
      if(step<0)return t;
      if(tri.n[step]!==NONE)t=tri.n[step];else return null;
    }
    const found=this.tris.findIndex(tri=>tri.alive&&[0,1,2].every(k=>orient(this.pts[tri.v[(k+1)%3]],this.pts[tri.v[(k+2)%3]],p)>=0));
    return found<0?null:found;
  }
  insert(p){
    const t0=this.locate(p);if(t0==null)return null;
    const hit=this.tris[t0].v.find(v=>dist2(this.pts[v],p)<1e-12);if(hit!=null)return hit;
    this.pass=(this.pass+1)>>>0;const pass=this.pass,bad=[t0];this.stamp[t0]=pass;
    for(let i=0;i<bad.length;i++)for(let k=0;k<3;k++){
      const nb=this.tris[bad[i]].n[k];
      if(nb===NONE||this.stamp[nb]===pass)continue;
      const [a,b,c]=this.tris[nb].v.map(v=>this.pts[v]);
      if(inCircle(a,b,c,p)>0){this.stamp[nb]=pass;bad.push(nb);}
    }
    const rim=[];
    for(const t of bad){
      const tri=this.tris[t];
      for(let k=0;k<3;k++){const nb=tri.n[k];if(nb===NONE||this.stamp[nb]!==pass)rim.push([tri.v[(k+1)%3],tri.v[(k+2)%3],nb]);}
      tri.alive=false;
    }
    const pi=this.pts.length;this.pts.push(p);const base=this.tris.length;
    rim.forEach(([a,b,o],i)=>{
      this.tris.push({v:[a,b,pi],n:[NONE,NONE,o],alive:true});this.stamp.push(0);
      const ot=this.tris[o];
      if(ot)for(let k=0;k<3;k++){const x=ot.v[(k+1)%3],y=ot.v[(k+2)%3];if((x===b&&y===a)||(x===a&&y===b))ot.n[k]=base+i;}
    });
    rim.forEach(([a,b],i)=>{
      const acrossB=rim.findIndex(r=>r[0]===b),acrossA=rim.findIndex(r=>r[1]===a);
      this.tris[base+i].n[0]=acrossB<0?NONE:base+acrossB;
      this.tris[base+i].n[1]=acrossA<0?NONE:base+acrossA;
    });
    this.last=base;return pi;
  }
  edges(){const e=new Set();for(const t of this.tris)if(t.alive)for(let k=0;k<3;k++){const a=t.v[k],b=t.v[(k+1)%3];e.add((a<b?a:b)+','+(a<b?b:a));}return e;}
}

function bandOrder(pos,tris){
  const adj=pos.map(()=>[]);
  for(const t of tris)for(let k=0;k<3;k++){adj[t[k]].push(t[(k+1)%3]);adj[t[(k+1)%3]].push(t[k]);}
  adj.forEach(a=>{a.sort((p,q)=>p-q);for(let i=a.length-1;i>0;i--)if(a[i]===a[i-1])a.splice(i,1);});
  const starts=pos.map((_,i)=>i).filter(i=>adj[i].length).sort((a,b)=>pos[a][1]-pos[b][1]||pos[a][0]-pos[b][0]);
  const seen=Array(pos.length).fill(false),order=[];
  for(const s of starts){
    if(seen[s])continue;seen[s]=true;const first=order.length;order.push(s);
    for(let i=first;i<order.length;i++){
      const next=adj[order[i]].filter(w=>!seen[w]).sort((a,b)=>adj[a].length-adj[b].length);
      for(const w of next){seen[w]=true;order.push(w);}
    }
  }
  order.reverse();return order;
}

export function buildPuppetMesh(canvas,density,expansion){
  const e=Number.isFinite(expansion)?Math.max(-200,Math.min(200,expansion)):0;
  const spacing=Math.max(2,(Math.max(canvas.width,canvas.height)+2*Math.max(0,e))/(CELLS[density]||20));
  const field=fieldFromCanvas(canvas,e),loops=outline(field);
  if(!loops.length)return {verts:[],tris:[],spacing};
  let tol=Math.max(0.5,0.5*field.g),rings;
  for(;;){
    rings=loops.map(loop=>densify(simplify(loop,tol),spacing));
    if(rings.reduce((n,r)=>n+r.length,0)<=MAX_OUTLINE||tol>spacing)break;
    tol*=2;
  }
  const lo=[field.x0,field.y0],hi=[field.x0+field.bw*field.g,field.y0+field.bh*field.g];
  const dl=new Delaunay(lo,hi);let segs=[];
  for(const ring of rings){
    const idx=ring.map(p=>dl.insert(p)).filter(v=>v!=null);
    for(let k=0;k<idx.length;k++){const a=idx[k],b=idx[(k+1)%idx.length];if(a!==b)segs.push([a,b]);}
  }
  const rise=spacing*Math.sqrt(3)/2,rows=Math.ceil((hi[1]-lo[1])/rise),cols=Math.ceil((hi[0]-lo[0])/spacing);
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
    const p=[lo[0]+(i+0.5*(j%2))*spacing,lo[1]+j*rise];
    if(field.value(p)<-0.5*spacing)dl.insert(p);
  }
  let budget=segs.length*2;
  for(let pass=0;pass<8;pass++){
    const edges=dl.edges();let next=[],split=false;
    for(const [a,b] of segs){
      if(!budget||edges.has((a<b?a:b)+','+(a<b?b:a))){next.push([a,b]);continue;}
      const c=dl.insert(lerp(dl.pts[a],dl.pts[b],0.5));
      if(c!=null&&c!==a&&c!==b){next.push([a,c],[c,b]);budget--;split=true;}else next.push([a,b]);
    }
    segs=next;if(!split)break;
  }
  const y0=segs.reduce((m,[a,b])=>Math.min(m,dl.pts[a][1],dl.pts[b][1]),Infinity);
  const y1=segs.reduce((m,[a,b])=>Math.max(m,dl.pts[a][1],dl.pts[b][1]),-Infinity);
  const rowN=y1>=y0?Math.floor((y1-y0)/spacing)+1:0,rowsOf=Array.from({length:rowN},()=>[]);
  segs.forEach(([a,b],i)=>{
    const loY=Math.min(dl.pts[a][1],dl.pts[b][1]),hiY=Math.max(dl.pts[a][1],dl.pts[b][1]);
    const r0=Math.floor((loY-y0)/spacing),r1=Math.floor((hiY-y0)/spacing);
    for(let r=r0;r<=r1&&r<rowN;r++)if(r>=0)rowsOf[r].push(i);
  });
  const contains=p=>{
    if(p[1]<y0)return false;
    const row=rowsOf[Math.floor((p[1]-y0)/spacing)];if(!row)return false;
    let odd=false;
    for(const i of row){const a=dl.pts[segs[i][0]],b=dl.pts[segs[i][1]];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<a[0]+(p[1]-a[1])/(b[1]-a[1])*(b[0]-a[0]))odd=!odd;}
    return odd;
  };
  const raw=[];
  for(const t of dl.tris){
    if(!t.alive||t.v.some(v=>v<3))continue;
    const [a,b,c]=t.v.map(v=>dl.pts[v]);
    if(orient(a,b,c)>1e-9&&contains([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3]))raw.push(t.v.slice());
  }
  if(!raw.length)return {verts:[],tris:[],spacing};
  const order=bandOrder(dl.pts,raw),remap=Array(dl.pts.length).fill(-1);
  order.forEach((old,i)=>remap[old]=i);
  return {verts:order.map(i=>dl.pts[i].slice()),tris:raw.map(t=>t.map(i=>remap[i])),spacing};
}
