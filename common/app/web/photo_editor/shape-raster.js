// PhotoCraft crates/vector/src/raster.rs: exact area coverage, one winding counter per component.
const RESIDUE=1e-6,COORD_LIMIT=1e15;
const clampCoord=v=>Math.max(-COORD_LIMIT,Math.min(COORD_LIMIT,v));
export function createRasterizer(inverted=false){return {edges:[],comps:[],inverted:Boolean(inverted),bounds:null,unionOnly:true};}
export function pushComponent(raster,polygons,op='combine',rule='nonzero'){
  const comp=raster.comps.length;
  raster.comps.push({op,rule});
  if(op!=='combine'&&comp!==0)raster.unionOnly=false;
  for(const poly of polygons||[]){
    const n=poly.length;
    if(n<2)continue;
    for(let i=0;i<n;i++){
      const a=poly[i],b=poly[(i+1)%n];
      if(![a.x,a.y,b.x,b.y].every(Number.isFinite))continue;
      const ax=clampCoord(a.x),ay=clampCoord(a.y),bx=clampCoord(b.x),by=clampCoord(b.y);
      const left=Math.min(ax,bx),top=Math.min(ay,by),right=Math.max(ax,bx),bottom=Math.max(ay,by);
      const box=raster.bounds;
      raster.bounds=box?[Math.min(box[0],left),Math.min(box[1],top),Math.max(box[2],right),Math.max(box[3],bottom)]:[left,top,right,bottom];
      if(ay===by)continue;
      const down=ay<by,p=down?[ax,ay]:[bx,by],q=down?[bx,by]:[ax,ay],dxdy=(q[0]-p[0])/(q[1]-p[1]);
      if(!Number.isFinite(dxdy))continue;
      raster.edges.push({x0:p[0],y0:p[1],y1:q[1],dir:down?1:-1,comp,dxdy});
    }
  }
}
export function sortEdges(raster){raster.edges.sort((a,b)=>a.y0-b.y0||0);}
function xAt(edge,y){return edge.x0+(y-edge.y0)*edge.dxdy;}
function componentInside(raster,comp,winding){return raster.comps[comp].rule==='evenodd'?(winding&1)!==0:winding!==0;}
function shapeInside(raster,wind,unionCount){
  if(raster.unionOnly)return (unionCount>0)!==raster.inverted;
  let acc=false;
  for(let i=0;i<raster.comps.length;i++){
    const on=componentInside(raster,i,wind[i]),op=i===0?'combine':raster.comps[i].op;
    acc=op==='subtract'?acc&&!on:op==='intersect'?acc&&on:op==='exclude'?acc!==on:acc||on;
  }
  return acc!==raster.inverted;
}
function addFull(acc,h){acc[0]+=h;}
function draw(acc,x0,xa,ya,xb,yb,w){
  const width=acc.length-1,left=x0;let ua=xa-left,ub=xb-left;const dy=yb-ya;
  if(dy<=0)return;
  if(ua>ub){const swap=ua;ua=ub;ub=swap;}
  const dx=ub-ua,height=(u0,u1)=>dx>1e-12?dy*(u1-u0)/dx:dy;
  if(ua<0){const cut=Math.min(ub,0);acc[0]+=w*height(ua,cut);if(ub<=0)return;ua=0;}
  if(ua>=width)return;
  const end=Math.min(ub,width);
  if(dx<=1e-12){const c=Math.floor(ua),f=ua-c;acc[c]+=w*dy*(1-f);acc[c+1]+=w*dy*f;return;}
  let u=ua;
  while(u<end){
    const c=Math.floor(u),v=Math.min(c+1,end),h=height(u,v),m=.5*(u+v)-c;
    acc[c]+=w*h*(1-m);acc[c+1]+=w*h*m;
    if(v<=u)break;
    u=v;
  }
}
function band(raster,a,b,x0,state,depth){
  if(b-a<=1e-12)return;
  state.band.length=0;
  const mid=.5*(a+b);
  for(const index of state.active){
    const edge=raster.edges[index];
    if(edge.y0<=mid&&edge.y1>=mid){const xa=xAt(edge,a),xb=xAt(edge,b);state.band.push({xa,xb,xm:.5*(xa+xb),idx:index});}
  }
  if(!state.band.length){if(raster.inverted)addFull(state.acc,b-a);return;}
  state.band.sort((p,q)=>p.xm-q.xm);
  if(depth<24){
    for(let k=1;k<state.band.length;k++){
      const p=state.band[k-1],q=state.band[k],top=p.xa-q.xa,bot=p.xb-q.xb;
      if(top>1e-9||bot>1e-9){
        const t=Math.abs(top-bot)>1e-15?top/(top-bot):.5;let y=a+(b-a)*Math.max(0,Math.min(1,t));
        if(y<=a+1e-9||y>=b-1e-9)y=mid;
        band(raster,a,y,x0,state,depth+1);band(raster,y,b,x0,state,depth+1);return;
      }
    }
  }
  state.wind.fill(0);
  let unionCount=0,inside=raster.inverted;
  if(inside)addFull(state.acc,b-a);
  for(const piece of state.band){
    const edge=raster.edges[piece.idx],c=edge.comp;
    if(raster.unionOnly){const was=componentInside(raster,c,state.wind[c]);state.wind[c]+=edge.dir;const now=componentInside(raster,c,state.wind[c]);unionCount+=Number(now)-Number(was);}
    else state.wind[c]+=edge.dir;
    const now=shapeInside(raster,state.wind,unionCount);
    if(now!==inside){draw(state.acc,x0,piece.xa,a,piece.xb,b,now?1:-1);inside=now;}
  }
}
export function renderCoverage(raster,x0,y0,x1,y1){
  const w=Math.max(0,x1-x0),h=Math.max(0,y1-y0),out=new Float64Array(w*h);
  if(!w||!h)return out;
  const state={active:[],cuts:[],band:[],wind:new Int32Array(Math.max(1,raster.comps.length)),acc:new Float64Array(w+1)};
  const top=y0;let next=0;
  while(next<raster.edges.length&&raster.edges[next].y0<top)next++;
  for(let i=0;i<next;i++)if(raster.edges[i].y1>top)state.active.push(i);
  for(let row=0;row<h;row++){
    const y=y0+row,ya=y,yb=y+1;
    state.active=state.active.filter(index=>raster.edges[index].y1>ya);
    while(next<raster.edges.length&&raster.edges[next].y0<yb){if(raster.edges[next].y1>ya)state.active.push(next);next++;}
    state.acc.fill(0);
    if(!state.active.length){if(raster.inverted)out.fill(1,row*w,(row+1)*w);continue;}
    const cuts=[ya,yb];
    for(const index of state.active){const edge=raster.edges[index];if(edge.y0>ya&&edge.y0<yb)cuts.push(edge.y0);if(edge.y1>ya&&edge.y1<yb)cuts.push(edge.y1);}
    cuts.sort((a,b)=>a-b);
    const unique=[];
    for(const cut of cuts)if(!unique.length||cut-unique.at(-1)>0)unique.push(cut);
    for(let i=1;i<unique.length;i++)band(raster,unique[i-1],unique[i],x0,state,0);
    let sum=0;
    for(let column=0;column<w;column++){sum+=state.acc[column];out[row*w+column]=sum>=RESIDUE?Math.min(sum,1):0;}
  }
  return out;
}
