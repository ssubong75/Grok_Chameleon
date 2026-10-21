// PhotoCraft crates/vector/src/trace.rs: marching squares at 0.5, then Schneider cubic fits.
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y});
const mul=(a,k)=>({x:a.x*k,y:a.y*k});
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const len=a=>Math.hypot(a.x,a.y);
const norm=a=>{const l=len(a);return l>1e-12?{x:a.x/l,y:a.y/l}:{x:0,y:0};};
function edgeKey(x,y,d){return x+','+y+','+d;}
export function maskContours(values,width,height,originX=0,originY=0,outside=0){
  const get=(x,y)=>x<0||y<0||x>=width||y>=height?outside:values[y*width+x],lvl=.5;
  const point=(a,b)=>{const va=get(a.x,a.y),vb=get(b.x,b.y),t=Math.abs(vb-va)>1e-9?Math.max(0,Math.min(1,(lvl-va)/(vb-va))):.5,ax=a.x+.5,ay=a.y+.5,bx=b.x+.5,by=b.y+.5;return {x:originX+ax+(bx-ax)*t,y:originY+ay+(by-ay)*t};};
  const next=new Map();
  const seg=(a,b)=>next.set(edgeKey(a[0],a[1],a[2]),b);
  for(let cy=-1;cy<height;cy++)for(let cx=-1;cx<width;cx++){
    const tl=get(cx,cy)>=lvl,tr=get(cx+1,cy)>=lvl,br=get(cx+1,cy+1)>=lvl,bl=get(cx,cy+1)>=lvl,idx=(tl?1:0)|(tr?2:0)|(br?4:0)|(bl?8:0);
    if(idx===0||idx===15)continue;
    const top=[cx,cy,0],bottom=[cx,cy+1,0],left=[cx,cy,1],right=[cx+1,cy,1],centre=(get(cx,cy)+get(cx+1,cy)+get(cx+1,cy+1)+get(cx,cy+1))/4;
    if(idx===1)seg(left,top);
    else if(idx===2)seg(top,right);
    else if(idx===3)seg(left,right);
    else if(idx===4)seg(right,bottom);
    else if(idx===5){if(centre>=lvl){seg(left,bottom);seg(right,top);}else{seg(left,top);seg(right,bottom);}}
    else if(idx===6)seg(top,bottom);
    else if(idx===7)seg(left,bottom);
    else if(idx===8)seg(bottom,left);
    else if(idx===9)seg(bottom,top);
    else if(idx===10){if(centre>=lvl){seg(top,left);seg(bottom,right);}else{seg(top,right);seg(bottom,left);}}
    else if(idx===11)seg(bottom,right);
    else if(idx===12)seg(right,left);
    else if(idx===13)seg(right,top);
    else if(idx===14)seg(top,left);
  }
  const edgePoint=e=>e[2]===0?point({x:e[0],y:e[1]},{x:e[0]+1,y:e[1]}):point({x:e[0],y:e[1]},{x:e[0],y:e[1]+1});
  const keys=[...next.keys()].map(key=>key.split(',').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]||a[2]-b[2]);
  const loops=[];
  for(const start of keys){
    const startKey=edgeKey(start[0],start[1],start[2]);
    if(!next.has(startKey))continue;
    const loop=[];let cur=start;
    while(next.has(edgeKey(cur[0],cur[1],cur[2]))){
      const n=next.get(edgeKey(cur[0],cur[1],cur[2]));next.delete(edgeKey(cur[0],cur[1],cur[2]));
      loop.push(edgePoint(cur));cur=n;if(cur[0]===start[0]&&cur[1]===start[1]&&cur[2]===start[2])break;
    }
    const compact=[];
    for(const p of loop){const prev=compact.at(-1);if(!prev||Math.abs(p.x-prev.x)>=1e-9||Math.abs(p.y-prev.y)>=1e-9)compact.push(p);}
    if(compact.length>=3)loops.push(compact);
  }
  return loops;
}
function walk(lp,i,window,fwd,closed){
  const n=lp.length;let acc=0,cur=i;
  for(let step=0;step<n;step++){
    if(!closed&&(fwd?cur+1>=n:cur===0))break;
    const nx=fwd?(cur+1)%n:(cur+n-1)%n,d=len(sub(lp[nx],lp[cur]));
    if(acc+d>=window){const t=(window-acc)/Math.max(d,1e-12);return add(lp[cur],mul(sub(lp[nx],lp[cur]),t));}
    acc+=d;cur=nx;
  }
  return lp[cur];
}
function corners(lp,window,closed){
  const n=lp.length,cosThresh=Math.cos(60*Math.PI/180),turn=lp.map((_,i)=>{if(!closed&&(i===0||i+1===n))return 1;return dot(norm(sub(lp[i],walk(lp,i,window,false,closed))),norm(sub(walk(lp,i,window,true,closed),lp[i])));});
  const out=[];
  for(let i=0;i<n;i++){
    if(turn[i]>=cosThresh)continue;
    let isMin=true,acc=0,j=i;
    while(acc<window){if(!closed&&j+1>=n)break;const nx=(j+1)%n;acc+=len(sub(lp[nx],lp[j]));j=nx;if(j===i)break;if(turn[j]<turn[i]){isMin=false;break;}}
    acc=0;j=i;
    while(isMin&&acc<window){if(!closed&&j===0)break;const pv=(j+n-1)%n;acc+=len(sub(lp[j],lp[pv]));j=pv;if(j===i)break;if(turn[j]<=turn[i])isMin=false;}
    if(isMin)out.push(i);
  }
  return out;
}
function bezier(b,t){const mt=1-t,a=mt*mt*mt,c=3*mt*mt*t,d=3*mt*t*t,e=t*t*t;return {x:a*b[0].x+c*b[1].x+d*b[2].x+e*b[3].x,y:a*b[0].y+c*b[1].y+d*b[2].y+e*b[3].y};}
function bezierD1(b,t){const mt=1-t,q0=mul(sub(b[1],b[0]),3),q1=mul(sub(b[2],b[1]),3),q2=mul(sub(b[3],b[2]),3);return add(add(mul(q0,mt*mt),mul(q1,2*mt*t)),mul(q2,t*t));}
function bezierD2(b,t){const r0=mul(add(sub(b[2],mul(b[1],2)),b[0]),6),r1=mul(add(sub(b[3],mul(b[2],2)),b[1]),6);return add(mul(r0,1-t),mul(r1,t));}
function chordParams(pts){const u=new Array(pts.length).fill(0);for(let i=1;i<pts.length;i++)u[i]=u[i-1]+len(sub(pts[i],pts[i-1]));const total=u.at(-1);if(total>0)for(let i=0;i<u.length;i++)u[i]/=total;return u;}
function generate(pts,u,t1,t2){
  const p0=pts[0],p3=pts.at(-1);const c=[[0,0],[0,0]],x=[0,0];
  for(let i=0;i<u.length;i++){const t=u[i],mt=1-t,b1=3*mt*mt*t,b2=3*mt*t*t,a1=mul(t1,b1),a2=mul(t2,b2);c[0][0]+=dot(a1,a1);c[0][1]+=dot(a1,a2);c[1][1]+=dot(a2,a2);const b0=mt*mt*mt,b3=t*t*t,tmp=sub(pts[i],add(mul(p0,b0+b1),mul(p3,b2+b3)));x[0]+=dot(a1,tmp);x[1]+=dot(a2,tmp);}
  c[1][0]=c[0][1];const det=c[0][0]*c[1][1]-c[1][0]*c[0][1],det0=c[0][0]*x[1]-c[1][0]*x[0],det1=x[0]*c[1][1]-x[1]*c[0][1];
  let al=Math.abs(det)>1e-12?det1/det:0,ar=Math.abs(det)>1e-12?det0/det:0,seg=len(sub(p3,p0)),eps=1e-6*seg;
  if(al<eps||ar<eps){al=seg/3;ar=seg/3;}
  return [p0,add(p0,mul(t1,al)),add(p3,mul(t2,ar)),p3];
}
function maxError(pts,b,u){let best=0,split=Math.floor(pts.length/2);for(let i=1;i<pts.length-1;i++){const d=sub(bezier(b,u[i]),pts[i]),e=dot(d,d);if(e>=best){best=e;split=i;}}return [best,split];}
function reparam(pts,u,b){return pts.map((p,i)=>{const t=u[i],q=bezier(b,t),d1=bezierD1(b,t),d2=bezierD2(b,t),num=dot(sub(q,p),d1),den=dot(d1,d1)+dot(sub(q,p),d2);return Math.abs(den)<1e-12?t:Math.max(0,Math.min(1,t-num/den));});}
function fitCubic(pts,t1,t2,err2,out,depth){
  const n=pts.length;
  if(n===2||depth>40){const d=len(sub(pts[n-1],pts[0]))/3;out.push([pts[0],add(pts[0],mul(t1,d)),add(pts[n-1],mul(t2,d)),pts[n-1]]);return;}
  let u=chordParams(pts),b=generate(pts,u,t1,t2);let [e,split]=maxError(pts,b,u);
  if(e<err2){out.push(b);return;}
  if(e<err2*16){for(let k=0;k<6;k++){const u2=reparam(pts,u,b),b2=generate(pts,u2,t1,t2);const [e2,s2]=maxError(pts,b2,u2);u=u2;b=b2;e=e2;split=s2;if(e<err2){out.push(b);return;}}}
  split=Math.max(1,Math.min(n-2,split));
  let tc=norm(sub(pts[split-1],pts[split+1]));if(len(tc)<.5)tc=norm(sub(pts[split-1],pts[split]));
  fitCubic(pts.slice(0,split+1),t1,tc,err2,out,depth+1);fitCubic(pts.slice(split),mul(tc,-1),t2,err2,out,depth+1);
}
function knot(anchor,inn,out,smooth){return {x:anchor.x,y:anchor.y,inX:inn.x,inY:inn.y,outX:out.x,outY:out.y,smooth};}
function fitClosed(lp,tol,window){
  const n=lp.length,cs=corners(lp,window,true),segs=[],cornerAt=[];
  if(!cs.length){const pts=lp.concat([lp[0]]),t=norm(sub(lp[1%n],lp[n-1])),before=segs.length;fitCubic(pts,t,mul(t,-1),tol*tol,segs,0);for(let i=before;i<segs.length;i++)cornerAt.push(false);}
  else for(let k=0;k<cs.length;k++){
    const c=cs[k],end=cs[(k+1)%cs.length],pts=[lp[c]];let j=c;
    do{j=(j+1)%n;pts.push(lp[j]);}while(j!==end);
    const m=pts.length,t1=norm(sub(pts[Math.min(1,m-1)],pts[0])),t2=norm(sub(pts[Math.max(0,m-2)],pts[m-1])),before=segs.length;
    fitCubic(pts,t1,t2,tol*tol,segs,0);
    for(let q=before;q<segs.length;q++)cornerAt.push(q===before);
  }
  const nodes=[];
  for(let i=0;i<segs.length;i++)nodes.push(knot(segs[i][0],segs[i][0],segs[i][1],!cornerAt[i]));
  for(let i=0;i<segs.length;i++){const inn=segs[i][2],node=nodes[(i+1)%segs.length];node.inX=inn.x;node.inY=inn.y;}
  return {nodes,closed:true,op:'combine'};
}
export function traceMask(values,width,height,originX=0,originY=0,outside=0,tolerance=1){
  const loops=maskContours(values,width,height,originX,originY,outside),parts=[];
  loops.forEach((loop,index)=>{const fitted=fitClosed(loop,Math.max(tolerance*.5,.05),1.5);fitted.op=index===0?'combine':'exclude';parts.push(fitted);});
  if(!parts.length)return {nodes:[],closed:true,op:'combine',subpaths:[],fillRule:'nonzero'};
  const [first,...subpaths]=parts;return {nodes:first.nodes,closed:true,op:first.op,subpaths,fillRule:'nonzero'};
}
