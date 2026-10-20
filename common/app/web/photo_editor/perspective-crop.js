import {resamplePixels} from './resample.js';
export function orderedCorners(points){
  const c=[points.reduce((sum,p)=>sum+p[0],0)/4,points.reduce((sum,p)=>sum+p[1],0)/4];
  const v=points.map(p=>[p[0],p[1]]);
  v.sort((a,b)=>Math.atan2(a[1]-c[1],a[0]-c[0])-Math.atan2(b[1]-c[1],b[0]-c[0]));
  let first=0;for(let i=1;i<4;i++)if(v[i][0]+v[i][1]<v[first][0]+v[first][1])first=i;
  return v.slice(first).concat(v.slice(0,first));
}
export function convexQuad(q){
  if(q.length!==4||q.some(p=>p.length!==2||!Number.isFinite(p[0])||!Number.isFinite(p[1])))return false;
  let area2=0;
  for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4],e1=[b[0]-a[0],b[1]-a[1]],e2=[c[0]-b[0],c[1]-b[1]],cross=e1[0]*e2[1]-e1[1]*e2[0];
    if(!Number.isFinite(cross)||cross<=1e-3*Math.hypot(e1[0],e1[1])*Math.hypot(e2[0],e2[1]))return false;area2+=a[0]*b[1]-b[0]*a[1];}
  return Number.isFinite(area2)&&area2>=2;
}
export function quadSize(q){const len=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]),[tl,tr,br,bl]=q;return[(len(tl,tr)+len(bl,br))/2,(len(tl,bl)+len(tr,br))/2];}
function mul(a,b){const r=Array(9).fill(0);for(let i=0;i<3;i++)for(let j=0;j<3;j++){let s=0;for(let k=0;k<3;k++)s+=a[i*3+k]*b[k*3+j];r[i*3+j]=s;}return r;}
export function inverseHomography(m){const c=[m[4]*m[8]-m[5]*m[7],m[2]*m[7]-m[1]*m[8],m[1]*m[5]-m[2]*m[4],m[5]*m[6]-m[3]*m[8],m[0]*m[8]-m[2]*m[6],m[2]*m[3]-m[0]*m[5],m[3]*m[7]-m[4]*m[6],m[1]*m[6]-m[0]*m[7],m[0]*m[4]-m[1]*m[3]],det=m[0]*c[0]+m[1]*c[3]+m[2]*c[6];return Math.abs(det)<1e-12?null:c.map(v=>v/det);}
export function applyHomography(m,x,y){const w=m[6]*x+m[7]*y+m[8];return[(m[0]*x+m[1]*y+m[2])/w,(m[3]*x+m[4]*y+m[5])/w];}
function squareToQuad(q){const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;if(Math.abs(sx)<1e-12&&Math.abs(sy)<1e-12)return[x1-x0,x3-x0,x0,y1-y0,y3-y0,y0,0,0,1];const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,den=dx1*dy2-dx2*dy1;if(Math.abs(den)<1e-12)return null;const g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den;return[x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1];}
export function rectToQuad(r,quad){const w=r[2]-r[0],h=r[3]-r[1];if(!(w>0&&h>0))return null;const sq=squareToQuad(quad);return sq?mul(sq,[1/w,0,-r[0]/w,0,1/h,-r[1]/h,0,0,1]):null;}
export function quadToRect(q,w,h){if(!(convexQuad(q)&&Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0))return null;const forward=rectToQuad([0,0,w,h],q);return forward?inverseHomography(forward):null;}
export function outputSize(q,width,height){const [qw,qh]=quadSize(q),ok=n=>Number.isFinite(n)&&n>=1;let w,h;if(ok(width)&&ok(height)){w=width;h=height;}else if(ok(width)){w=width;h=width*qh/qw;}else if(ok(height)){h=height;w=height*qw/qh;}else{w=qw;h=qh;}w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));if(!Number.isFinite(w)||!Number.isFinite(h)||w>32767||h>32767||w*h>64000000)return null;return{width:w,height:h};}
export function nearestAffine(q,w,h){const [tl,tr,br,bl]=q,u=[(tr[0]-tl[0]+br[0]-bl[0])/2,(tr[1]-tl[1]+br[1]-bl[1])/2],v=[(bl[0]-tl[0]+br[0]-tr[0])/2,(bl[1]-tl[1]+br[1]-tr[1])/2],det=u[0]*v[1]-v[0]*u[1];if(!Number.isFinite(det)||Math.abs(det)<1e-12)return[1,0,0,1,0,0];const m00=w*v[1]/det,m01=-w*v[0]/det,m10=-h*u[1]/det,m11=h*u[0]/det,c=[(tl[0]+tr[0]+br[0]+bl[0])/4,(tl[1]+tr[1]+br[1]+bl[1])/4];return[m00,m10,m01,m11,w/2-(m00*c[0]+m01*c[1]),h/2-(m10*c[0]+m11*c[1])];}
export function mapAffine(m,x,y){return[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
function localScale(m,x,y){const e=.5,a=applyHomography(m,x-e,y),b=applyHomography(m,x+e,y),c=applyHomography(m,x,y-e),d=applyHomography(m,x,y+e),jx=[b[0]-a[0],b[1]-a[1]],jy=[d[0]-c[0],d[1]-c[1]];return Math.sqrt(Math.abs(jx[0]*jy[1]-jx[1]*jy[0]));}
function cubicWeights(t){const A=-.75,near=x=>(A+2)*x*x*x-(A+3)*x*x+1,far=x=>A*(x*x*x-5*x*x+8*x-4);return[far(1+t),near(t),near(1-t),far(2-t)];}
export function warpImage(image,originX,originY,forward,width,height,interpolation='bicubic'){
  let src=image,ox=originX,oy=originY,h=forward;
  if(interpolation==='bicubic'){const inv0=inverseHomography(h);if(inv0){const p=applyHomography(inv0,width/2,height/2),scale=localScale(h,p[0],p[1]);if(scale>0&&scale<.999){const f=Math.max(scale,1/64);const reduced=resamplePixels({width:src.width,height:src.height,data:src.data},ox,oy,f,f,'bicubic',src.width,src.height);src={width:reduced.width,height:reduced.height,data:reduced.data};ox=reduced.x;oy=reduced.y;h=mul(h,[1/f,0,0,0,1/f,0,0,0,1]);}}}
  const inv=inverseHomography(h);const out=new Uint8ClampedArray(width*height*4);if(!inv)return out;
  const x0=ox,y0=oy,x1=ox+src.width,y1=oy+src.height,data=src.data,sw=src.width,sh=src.height;
  const mx=width/2,my=height/2,o=applyHomography(inv,mx,my),dx=applyHomography(inv,mx+1,my),dy=applyHomography(inv,mx,my+1),extent=e=>Number.isFinite(e)&&e>1e-12?e:1,footU=extent(Math.abs(dx[0]-o[0])+Math.abs(dy[0]-o[0])),footV=extent(Math.abs(dx[1]-o[1])+Math.abs(dy[1]-o[1]));
  const at=(x,y,c)=>{if(x<x0||y<y0||x>=x1||y>=y1)return 0;const i=((y-oy)*sw+(x-ox))*4;return c===3?data[i+3]/255:data[i+c]/255*(data[i+3]/255);};
  const clamped=(x,y,c)=>at(Math.max(x0,Math.min(x1-1,x)),Math.max(y0,Math.min(y1-1,y)),c);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=applyHomography(inv,x+.5,y+.5);let u=p[0]-.5,v=p[1]-.5;if(u<x0-1||v<y0-1||u>x1||v>y1)continue;
    const acc=[0,0,0,0];
    if(interpolation==='nearest'){const ix=Math.floor(u+.5),iy=Math.floor(v+.5);for(let c=0;c<4;c++)acc[c]=at(ix,iy,c);}
    else if(interpolation==='bilinear'){const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;for(const [oyy,wy] of [[0,1-fy],[1,fy]])for(const [oxx,wx] of [[0,1-fx],[1,fx]])for(let c=0;c<4;c++)acc[c]+=clamped(ix+oxx,iy+oyy,c)*wx*wy;}
    else{const ix=Math.floor(u),iy=Math.floor(v),wx=cubicWeights(u-ix),wy=cubicWeights(v-iy);for(let j=0;j<4;j++)for(let i=0;i<4;i++){const k=wx[i]*wy[j];for(let c=0;c<4;c++)acc[c]+=clamped(ix-1+i,iy-1+j,c)*k;}}
    if(interpolation!=='nearest'){const cu=Math.max(0,Math.min(1,(Math.min(u+.5-x0,x1-(u+.5))/footU)+.5)),cv=Math.max(0,Math.min(1,(Math.min(v+.5-y0,y1-(v+.5))/footV)+.5));for(let c=0;c<4;c++)acc[c]*=cu*cv;}
    const al=Math.max(0,Math.min(1,acc[3]));if(al<=0)continue;const o4=(y*width+x)*4;for(let c=0;c<3;c++)out[o4+c]=Math.max(0,Math.min(255,Math.round(acc[c]/al*255)));out[o4+3]=Math.round(al*255);
  }
  return out;
}
export function insideQuad(q,p){return q.every((_,i)=>{const a=q[i],b=q[(i+1)%4];return(b[0]-a[0])*(p.y-a[1])-(b[1]-a[1])*(p.x-a[0])>=0;});}
export function installPerspectiveCrop({overlay,state,getDocument,point,draw,message,apply}){
  let drag=null,clicks=[],quad=null,docRef=null;
  const tool=()=>(state.activeTool||state.tool)==='perspectiveCrop';
  const tol=()=>8/Math.max(.01,state.zoom);
  const preview=()=>{if(drag?.kind==='new'){const x0=Math.min(drag.start.x,drag.cur.x),y0=Math.min(drag.start.y,drag.cur.y),x1=Math.max(drag.start.x,drag.cur.x),y1=Math.max(drag.start.y,drag.cur.y);return x1>x0&&y1>y0?[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]:null;}return quad;};
  const reset=()=>{drag=null;clicks=[];quad=null;};
  overlay.addEventListener('pointerdown',e=>{if(e.button!==0||!tool()||!getDocument())return;const d=getDocument();if(docRef&&docRef!==d)reset();docRef=d;const p=point(e);if(quad){let best=null;quad.forEach((c,i)=>{const dist=Math.hypot(c[0]-p.x,c[1]-p.y);if(dist<=tol()&&(!best||dist<best.dist))best={i,dist};});drag=best?{kind:'corner',index:best.i,offset:[p.x-quad[best.i][0],p.y-quad[best.i][1]]}:insideQuad(quad,p)?{kind:'move',start:p,base:quad.map(c=>c.slice())}:{kind:'new',start:p,cur:p};}else drag={kind:'new',start:p,cur:p};state.gesture={tool:'perspectiveCrop'};overlay.setPointerCapture(e.pointerId);e.stopImmediatePropagation();draw();},true);
  overlay.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);if(drag.kind==='new')drag.cur=p;else if(drag.kind==='corner')quad[drag.index]=[p.x-drag.offset[0],p.y-drag.offset[1]];else quad=drag.base.map(c=>[c[0]+p.x-drag.start.x,c[1]+p.y-drag.start.y]);e.stopImmediatePropagation();draw();},true);
  const finish=e=>{if(!drag)return;const kind=drag.kind,start=drag.start,cur=drag.kind==='new'?point(e):drag.cur;drag=null;state.gesture=null;e?.stopImmediatePropagation();if(kind==='new'){const click=tol()*3/8;if(Math.abs(cur.x-start.x)<=click&&Math.abs(cur.y-start.y)<=click){clicks.push([start.x,start.y]);if(clicks.length===4){quad=orderedCorners(clicks);clicks=[];}}else{clicks=[];const x0=Math.min(start.x,cur.x),y0=Math.min(start.y,cur.y),x1=Math.max(start.x,cur.x),y1=Math.max(start.y,cur.y);quad=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}}draw();};
  overlay.addEventListener('pointerup',finish,true);overlay.addEventListener('pointercancel',()=>{drag=null;state.gesture=null;},true);
  return{cancel(){reset();draw();},pending(){return Boolean(quad||clicks.length||drag);},commit(){if(!quad)return;if(!convexQuad(quad)){message('The corners must form a convex quadrilateral.');return;}try{apply(quad.map(c=>[c[0],c[1]]));reset();}catch(error){message(error.message);}draw();},draw(ctx){if(!tool())return;const q=preview();if(q){const ok=convexQuad(q);ctx.save();ctx.strokeStyle=ok?'#4da3ff':'#e53e3e';ctx.lineWidth=1.5/Math.max(.01,state.zoom);ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.stroke();if(ok){const h=rectToQuad([0,0,1,1],q);if(h){const side=Math.max(...q.map((p,i)=>Math.hypot(q[(i+1)%4][0]-p[0],q[(i+1)%4][1]-p[1])))*state.zoom,n=Math.max(2,Math.min(12,Math.round(side/48)));ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=.75/Math.max(.01,state.zoom);for(let k=1;k<n;k++){const t=k/n,a=applyHomography(h,t,0),b=applyHomography(h,t,1),c=applyHomography(h,0,t),d=applyHomography(h,1,t);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.moveTo(c[0],c[1]);ctx.lineTo(d[0],d[1]);ctx.stroke();}}}if(quad){ctx.fillStyle='#fff';const s=8/Math.max(.01,state.zoom);for(const p of q)ctx.strokeRect(p[0]-s/2,p[1]-s/2,s,s);}ctx.restore();}if(clicks.length){ctx.save();ctx.strokeStyle='#4da3ff';ctx.fillStyle='#fff';ctx.beginPath();clicks.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();for(const p of clicks){ctx.beginPath();ctx.arc(p[0],p[1],4/Math.max(.01,state.zoom),0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.restore();}}};
}
