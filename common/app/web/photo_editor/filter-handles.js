import {VanishingPlane,VanishingScene} from './vanishing-geometry.js';
function preview(body,source){
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(Math.min(700,source.width,420*source.width/Math.max(1,source.height))));
  canvas.height=Math.max(1,Math.round(canvas.width*source.height/Math.max(1,source.width)));
  canvas.style.cssText='display:block;max-width:100%;touch-action:none;cursor:crosshair;background:#222';
  body.prepend(canvas);
  const scale=()=>[canvas.width/source.width,canvas.height/source.height];
  const position=event=>{const rect=canvas.getBoundingClientRect();return[Math.max(0,Math.min(source.width,(event.clientX-rect.left)/rect.width*source.width)),Math.max(0,Math.min(source.height,(event.clientY-rect.top)/rect.height*source.height))];};
  return {canvas,scale,position};
}
function numberField(body,name){return body.querySelector(`[name="${name}"]`);}
function writeNumber(field,value){if(!field)return;field.value=String(Math.round(value*1000)/1000);field.dispatchEvent(new Event('input',{bubbles:true}));}
function dot(ctx,x,y){ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#222';ctx.stroke();}
export function gridSteps(corners,lu,lv,size,alongU){
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const k=Math.max(distance(corners[0],corners[1])/lu,distance(corners[3],corners[2])/lu,distance(corners[0],corners[3])/lv,distance(corners[1],corners[2])/lv);
  const cell=Math.max(1,size)/k,len=alongU?lu:lv;
  if(!Number.isFinite(cell)||cell<=0||!Number.isFinite(len))return [];
  const step=cell/len,lines=[];
  for(let j=1;j<200;j++){const t=j*step;if(t>=1-1e-9)break;lines.push(t);}
  return lines;
}
export function slidQuad(h,u0,v0,u1,v1){
  const m=h.values,w=(u,v)=>m[6]*u+m[7]*v+m[8],mid=w(.5,.5),side=Math.sign(mid),uv=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
  if(!Number.isFinite(mid)||uv.some(([u,v])=>w(u,v)*side<=1e-9*Math.abs(mid)))return null;
  const quad=uv.map(([u,v])=>h.apply(u,v));
  if(quad.some(point=>point.some(n=>!Number.isFinite(n))))return null;
  try{if(new VanishingPlane(quad).check([0,0])==='invalid')return null;}catch{return null;}
  return quad;
}
export function pasteExtent(pasteWidth,lu,lv,clipWidth,clipHeight){
  if(![pasteWidth,lu,lv,clipWidth,clipHeight].every(Number.isFinite)||!(lu>1e-12)||!(lv>1e-12)||!(clipHeight>0))return null;
  return [pasteWidth,pasteWidth*lu/lv*clipHeight/Math.max(clipWidth,1)];
}
export function pasteAt(u,v,offset){
  const at=[u+offset[0],v+offset[1]].map(n=>Math.min(2,Math.max(-1,n)));
  return at.every(Number.isFinite)?at:null;
}
export function pasteCells(at,ext,n=24){
  const cells=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const u=at[0]+(i+.5)/n*ext[0],v=at[1]+(j+.5)/n*ext[1];if(u>=0&&u<=1&&v>=0&&v<=1)cells.push([i,j]);}
  return cells;
}
function drawImageTriangle(ctx,image,dst,src){
  const [x0,y0,x1,y1,x2,y2]=dst,[sx0,sy0,sx1,sy1,sx2,sy2]=src,denom=sx0*(sy1-sy2)+sx1*(sy2-sy0)+sx2*(sy0-sy1);
  if(!(Math.abs(denom)>1e-8))return;
  ctx.save();ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.lineTo(x2,y2);ctx.closePath();ctx.clip();
  ctx.transform((x0*(sy1-sy2)+x1*(sy2-sy0)+x2*(sy0-sy1))/denom,(y0*(sy1-sy2)+y1*(sy2-sy0)+y2*(sy0-sy1))/denom,(sx0*(x1-x2)+sx1*(x2-x0)+sx2*(x0-x1))/denom,(sx0*(y1-y2)+sx1*(y2-y0)+sx2*(y0-y1))/denom,(sx0*(sy1*x2-sy2*x1)+sx1*(sy2*x0-sy0*x2)+sx2*(sy0*x1-sy1*x0))/denom,(sx0*(sy1*y2-sy2*y1)+sx1*(sy2*y0-sy0*y2)+sx2*(sy0*y1-sy1*y0))/denom);
  ctx.drawImage(image,0,0);ctx.restore();
}
function paintPaste(ctx,h,at,ext,image,sx,sy){
  const n=24,pts=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)pts.push(h.apply(at[0]+i/n*ext[0],at[1]+j/n*ext[1]));
  ctx.save();ctx.globalAlpha=230/255;
  for(const [i,j] of pasteCells(at,ext,n)){
    const a=j*(n+1)+i,s0=i/n,s1=(i+1)/n,t0=j/n,t1=(j+1)/n,tri=(a0,a1,a2,u0,v0,u1,v1,u2,v2)=>{const p0=pts[a0],p1=pts[a1],p2=pts[a2];if([p0,p1,p2].some(p=>p.some(value=>!Number.isFinite(value))))return;drawImageTriangle(ctx,image,[p0[0]*sx,p0[1]*sy,p1[0]*sx,p1[1]*sy,p2[0]*sx,p2[1]*sy],[u0*image.width,v0*image.height,u1*image.width,v1*image.height,u2*image.width,v2*image.height]);};
    tri(a,a+1,a+n+2,s0,t0,s1,t0,s1,t1);tri(a,a+n+2,a+n+1,s0,t0,s1,t1,s0,t1);
  }
  ctx.restore();
}

export function mountPlaneHandles(body,source,clipSize=null){
  const {canvas,scale,position}=preview(body,source);
  const corners=()=>[0,1,2,3].map(index=>[Number(numberField(body,'x'+index)?.value),Number(numberField(body,'y'+index)?.value)]);
  const paint=()=>{const ctx=canvas.getContext('2d'),[sx,sy]=scale(),points=corners();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);
    if(points.every(point=>point.every(Number.isFinite))){try{const plane=new VanishingPlane(points),scene=new VanishingScene(plane,[source.width/2,source.height/2],Number(numberField(body,'focalLength')?.value)||0,Math.max(source.width,source.height)),frame=scene.frame(0);if(frame&&plane.check(scene.center)!=='invalid'){const size=Math.max(2,Math.min(2000,Number(numberField(body,'gridSize')?.value)||100)),line=(u0,v0,u1,v1)=>{const a=frame.h.apply(u0,v0),b=frame.h.apply(u1,v1);if([a,b].some(p=>p.some(n=>!Number.isFinite(n))))return;ctx.beginPath();ctx.moveTo(a[0]*sx,a[1]*sy);ctx.lineTo(b[0]*sx,b[1]*sy);ctx.stroke();};ctx.strokeStyle='rgba(78,224,255,.55)';ctx.lineWidth=1;for(const u of gridSteps(points,frame.width,frame.height,size,true))line(u,0,u,1);for(const v of gridSteps(points,frame.width,frame.height,size,false))line(0,v,1,v);}}catch{}}
    ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point[0]*sx,point[1]*sy):ctx.moveTo(point[0]*sx,point[1]*sy));ctx.closePath();ctx.strokeStyle='#4ee0ff';ctx.lineWidth=2;ctx.stroke();points.forEach(point=>dot(ctx,point[0]*sx,point[1]*sy));
    try{const h=new VanishingPlane(points).homography();if(h)for(const [u,v] of [[.5,0],[1,.5],[.5,1],[0,.5]]){const p=h.apply(u,v);if(p.every(Number.isFinite)){ctx.strokeStyle='#4ee0ff';ctx.strokeRect(p[0]*sx-4,p[1]*sy-4,8,8);}}}catch{}
    try{const clip=numberField(body,'pasteEnabled')?.checked&&typeof clipSize==='function'?clipSize():null,plane=new VanishingPlane(points),scene=new VanishingScene(plane,[source.width/2,source.height/2],Number(numberField(body,'focalLength')?.value)||0,Math.max(source.width,source.height)),frame=plane.check(scene.center)==='invalid'?null:scene.frame(0),at=[Number(numberField(body,'atU')?.value),Number(numberField(body,'atV')?.value)],ext=clip&&frame?pasteExtent(Number(numberField(body,'pasteWidth')?.value),frame.width,frame.height,clip.width,clip.height):null;if(ext&&at.every(Number.isFinite)){if(clip.canvas)paintPaste(ctx,frame.h,at,ext,clip.canvas,sx,sy);const quad=[[0,0],[1,0],[1,1],[0,1]].map(([s,t])=>frame.h.apply(at[0]+s*ext[0],at[1]+t*ext[1]));if(quad.every(p=>p.every(Number.isFinite))){ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p[0]*sx,p[1]*sy):ctx.moveTo(p[0]*sx,p[1]*sy));ctx.closePath();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}}}catch{}
    const read=(name,fallback)=>Number(numberField(body,name)?.value)||fallback,sourcePoint=[read('sourceX',source.width*.3),read('sourceY',source.height*.5)],start=[read('startX',source.width*.5),read('startY',source.height*.5)],end=[read('endX',source.width*.6),read('endY',source.height*.5)];
    ctx.beginPath();ctx.moveTo(start[0]*sx,start[1]*sy);ctx.lineTo(end[0]*sx,end[1]*sy);ctx.strokeStyle='#ffb020';ctx.lineWidth=2;ctx.stroke();dot(ctx,start[0]*sx,start[1]*sy);dot(ctx,end[0]*sx,end[1]*sy);ctx.fillStyle='#ffb020';ctx.beginPath();ctx.arc(sourcePoint[0]*sx,sourcePoint[1]*sy,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#222';ctx.stroke();};
  let drag=null;
  canvas.onpointerdown=event=>{if(event.button!==0)return;const point=position(event),points=corners(),near=(p,limit=12)=>Math.hypot(p[0]-point[0],p[1]-point[1])<limit,hit=points.findIndex(near);if(hit>=0){drag={kind:'corner',index:hit};canvas.setPointerCapture(event.pointerId);return;}
    try{const h=new VanishingPlane(points).homography(),inv=h?.inverse();if(h&&inv){const edge=[[.5,0],[1,.5],[.5,1],[0,.5]].findIndex(([u,v])=>near(h.apply(u,v)));if(edge>=0){drag={kind:'edge',edge,h,inv};canvas.setPointerCapture(event.pointerId);return;}}}catch{}
    try{const clip=numberField(body,'pasteEnabled')?.checked&&typeof clipSize==='function'?clipSize():null,plane=new VanishingPlane(points),inv=plane.homography()?.inverse(),scene=new VanishingScene(plane,[source.width/2,source.height/2],Number(numberField(body,'focalLength')?.value)||0,Math.max(source.width,source.height)),frame=plane.check(scene.center)==='invalid'?null:scene.frame(0),at=[Number(numberField(body,'atU')?.value),Number(numberField(body,'atV')?.value)],ext=clip&&frame?pasteExtent(Number(numberField(body,'pasteWidth')?.value),frame.width,frame.height,clip.width,clip.height):null;if(inv&&ext&&at.every(Number.isFinite)){const [u,v]=inv.apply(point[0],point[1]);if(u>=at[0]&&u<=at[0]+ext[0]&&v>=at[1]&&v<=at[1]+ext[1]){drag={kind:'paste',offset:[at[0]-u,at[1]-v],inv};canvas.setPointerCapture(event.pointerId);return;}}}catch{}
    const read=(name,fallback)=>Number(numberField(body,name)?.value)||fallback,handles=[['sourceX','sourceY',read('sourceX',source.width*.3),read('sourceY',source.height*.5)],['startX','startY',read('startX',source.width*.5),read('startY',source.height*.5)],['endX','endY',read('endX',source.width*.6),read('endY',source.height*.5)]],brush=handles.find(([, ,x,y])=>near([x,y]));if(!brush)return;drag={kind:'brush',x:brush[0],y:brush[1]};canvas.setPointerCapture(event.pointerId);};
  canvas.onpointermove=event=>{if(drag==null)return;const point=position(event);
    if(drag.kind==='corner'){writeNumber(numberField(body,'x'+drag.index),point[0]);writeNumber(numberField(body,'y'+drag.index),point[1]);paint();return;}
    if(drag.kind==='brush'){writeNumber(numberField(body,drag.x),point[0]);writeNumber(numberField(body,drag.y),point[1]);paint();return;}
    if(drag.kind==='paste'){const [u,v]=drag.inv.apply(point[0],point[1]),at=pasteAt(u,v,drag.offset);if(!at)return;writeNumber(numberField(body,'atU'),at[0]);writeNumber(numberField(body,'atV'),at[1]);paint();return;}
    const [u,v]=drag.inv.apply(point[0],point[1]);if(!Number.isFinite(u)||!Number.isFinite(v))return;
    const span=drag.edge===0?[0,Math.min(v,.99),1,1]:drag.edge===1?[0,0,Math.max(u,.01),1]:drag.edge===2?[0,0,1,Math.max(v,.01)]:[Math.min(u,.99),0,1,1],quad=slidQuad(drag.h,...span);if(!quad)return;
    quad.forEach((corner,index)=>{writeNumber(numberField(body,'x'+index),corner[0]);writeNumber(numberField(body,'y'+index),corner[1]);});paint();};
  canvas.onpointerup=()=>{drag=null;};
  body.addEventListener('input',()=>{if(drag==null)paint();});
  paint();
}

export function ringAmount(amount,last,angle,max){
  const tau=Math.PI*2,turn=((angle-last+Math.PI)%tau+tau)%tau-Math.PI;
  return {amount:Math.min(max,Math.max(0,amount+turn/tau*max)),angle};
}
export function irisPoint(width,height,pin,u,v){
  const short=Math.max(1,Math.min(width,height)),rx=(Number.isFinite(Number(pin.radiusX))?Number(pin.radiusX):.35)*short,ry=(Number.isFinite(Number(pin.radiusY))?Number(pin.radiusY):.25)*short,a=(Number(pin.angle)||0)*Math.PI/180,sin=Math.sin(a),cos=Math.cos(a),x=u*rx,y=v*ry;
  return [pin.x*width+x*cos-y*sin,pin.y*height+x*sin+y*cos];
}
export function irisAxis(width,height,pin,x,y,axis){
  const short=Math.max(1,Math.min(width,height)),dx=x-pin.x*width,dy=y-pin.y*height,r=Math.min(1,Math.max(.01,Math.hypot(dx,dy)/short));
  let angle=Math.atan2(dy,dx)*180/Math.PI-90*axis;angle=((angle+180)%360+360)%360-180;
  return {radiusX:axis%2===0?r:Math.min(1,Math.max(.01,Number.isFinite(Number(pin.radiusX))?Number(pin.radiusX):.35)),radiusY:axis%2===0?Math.min(1,Math.max(.01,Number.isFinite(Number(pin.radiusY))?Number(pin.radiusY):.25)):r,angle};
}
function irisExponent(pin){const roundness=Math.min(100,Math.max(0,Number.isFinite(Number(pin.roundness))?Number(pin.roundness):0));return 2+roundness/100*6;}
function irisDiagonal(pin){return .5**(1/irisExponent(pin));}
export function irisLocal(width,height,pin,x,y){
  const short=Math.max(1,Math.min(width,height)),rx=(Number.isFinite(Number(pin.radiusX))?Number(pin.radiusX):.35)*short,ry=(Number.isFinite(Number(pin.radiusY))?Number(pin.radiusY):.25)*short,a=(Number(pin.angle)||0)*Math.PI/180,sin=Math.sin(a),cos=Math.cos(a),dx=x-pin.x*width,dy=y-pin.y*height;
  return [(dx*cos+dy*sin)/rx,(-dx*sin+dy*cos)/ry];
}
export function irisRoundHandle(pin){const t=irisDiagonal(pin);return [t,-t];}
export function irisFeatherHandles(pin){const k=(Number.isFinite(Number(pin.feather))?Number(pin.feather):.5)*irisDiagonal(pin);return [[k,k],[-k,k],[-k,-k],[k,-k]];}
export function irisRoundness(width,height,pin,x,y){
  const [u,v]=irisLocal(width,height,pin,x,y),t=Math.min(.5**(1/8),Math.max(Math.sqrt(.5),(Math.abs(u)+Math.abs(v))/2)),m=-Math.LN2/Math.log(t);
  return Math.min(100,Math.max(0,(m-2)/6*100));
}
export function irisFeather(width,height,pin,x,y){
  const [u,v]=irisLocal(width,height,pin,x,y),m=irisExponent(pin),e=(Math.abs(u)**m+Math.abs(v)**m)**(1/m),feather=Number.isFinite(e)?e:Number.isFinite(Number(pin.feather))?Number(pin.feather):.5;
  return Math.min(.99,Math.max(0,feather));
}
function tiltAxes(angle){const a=(Number(angle)||0)*Math.PI/180,s=Math.sin(a),c=Math.cos(a);return {n:[s,c],d:[c,-s]};}
export function tiltOffset(width,height,pin,x,y){const {n}=tiltAxes(pin.angle);return (x-pin.x*width)*n[0]+(y-pin.y*height)*n[1];}
export function tiltPoint(width,height,pin,offset,along){const {n,d}=tiltAxes(pin.angle),cx=pin.x*width,cy=pin.y*height;return [cx+n[0]*offset+d[0]*along,cy+n[1]*offset+d[1]*along];}
export function tiltBand(width,height,pin,x,y,focus){
  const short=Math.max(1,Math.min(width,height)),across=Math.abs(tiltOffset(width,height,pin,x,y))/short,base=Math.min(1,Math.max(0,Number(focus)||0));
  return {focus:Math.min(1,Math.max(0,across)),transition:Math.min(1,Math.max(.01,across-base))};
}
export function mountBlurHandles(body,source,kind){
  const {canvas,scale,position}=preview(body,source);
  const unit=point=>[point[0]/source.width,point[1]/source.height];
  const read=()=>{
    if(kind==='pathBlur'){const raw=numberField(body,'paths')?.value.trim();if(raw){try{const parsed=JSON.parse(raw);if(Array.isArray(parsed)&&parsed[0]?.points)return parsed;}catch{}}return [{points:[[Number(numberField(body,'startX')?.value)||.2,Number(numberField(body,'startY')?.value)||.5],[Number(numberField(body,'endX')?.value)||.8,Number(numberField(body,'endY')?.value)||.5]],speed:Number(numberField(body,'speed')?.value)||50,taper:Number(numberField(body,'taper')?.value)||0}];}
    if(kind==='tiltShift'){const focus=Number(numberField(body,'focus')?.value),transition=Number(numberField(body,'transition')?.value);return [{x:Number(numberField(body,'centerX')?.value)||.5,y:Number(numberField(body,'centerY')?.value)||.5,angle:Number(numberField(body,'angle')?.value)||0,focus:Number.isFinite(focus)?focus:.1,transition:Number.isFinite(transition)?transition:.15,blur:Number(numberField(body,'blur')?.value)||15}];}
    const raw=numberField(body,'pins')?.value.trim();
    if(raw){try{const parsed=JSON.parse(raw);if(Array.isArray(parsed)&&parsed.length)return parsed;}catch{}}
    const radiusX=kind==='spinBlur'?0.3:0.35,radiusY=kind==='spinBlur'?0.3:0.25;
    return [{x:Number(numberField(body,'centerX')?.value)||.5,y:Number(numberField(body,'centerY')?.value)||.5,blur:Number(numberField(body,'blur')?.value)||15,radiusX:Number(numberField(body,'radiusX')?.value)||radiusX,radiusY:Number(numberField(body,'radiusY')?.value)||radiusY,angle:Number(numberField(body,'angle')?.value)||0,blurAngle:Number(numberField(body,'blurAngle')?.value)||15,roundness:Number(numberField(body,'roundness')?.value)||0,feather:Number.isFinite(Number(numberField(body,'feather')?.value))?Number(numberField(body,'feather').value):.5}];
  };
  const commit=(items)=>{
    if(kind==='pathBlur'){const field=numberField(body,'paths');if(field){field.value=JSON.stringify(items);field.dispatchEvent(new Event('input',{bubbles:true}));}const first=items[0]?.points||[];writeNumber(numberField(body,'startX'),first[0]?.[0]??.2);writeNumber(numberField(body,'startY'),first[0]?.[1]??.5);writeNumber(numberField(body,'endX'),first.at(-1)?.[0]??.8);writeNumber(numberField(body,'endY'),first.at(-1)?.[1]??.5);return;}
    if(kind==='tiltShift'){writeNumber(numberField(body,'centerX'),items[0].x);writeNumber(numberField(body,'centerY'),items[0].y);writeNumber(numberField(body,'angle'),items[0].angle);writeNumber(numberField(body,'focus'),items[0].focus);writeNumber(numberField(body,'transition'),items[0].transition);writeNumber(numberField(body,'blur'),items[0].blur);return;}
    const field=numberField(body,'pins');if(field){field.value=JSON.stringify(items);field.dispatchEvent(new Event('input',{bubbles:true}));}
    if(!items[0])return;
    writeNumber(numberField(body,'centerX'),items[0].x);writeNumber(numberField(body,'centerY'),items[0].y);
  };
  const paint=items=>{const ctx=canvas.getContext('2d'),[sx,sy]=scale();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);ctx.strokeStyle='#ffcd45';ctx.lineWidth=2;
    if(kind==='pathBlur'){for(const path of items){ctx.beginPath();path.points.forEach((point,index)=>index?ctx.lineTo(point[0]*source.width*sx,point[1]*source.height*sy):ctx.moveTo(point[0]*source.width*sx,point[1]*source.height*sy));ctx.stroke();path.points.forEach(point=>dot(ctx,point[0]*source.width*sx,point[1]*source.height*sy));}return;}
    for(const pin of items){const x=pin.x*source.width*sx,y=pin.y*source.height*sy;dot(ctx,x,y);}
    const pin=items[selected]||items[0];if(pin){const x=pin.x*source.width*sx,y=pin.y*source.height*sy,rect=canvas.getBoundingClientRect(),ring=24*canvas.width/Math.max(1,rect.width),max=kind==='spinBlur'?360:500,amount=kind==='spinBlur'?Number(pin.blurAngle)||0:kind==='tiltShift'?Number(pin.blur)||0:Number(pin.blur)||0,frac=Math.min(1,Math.max(0,amount/max));ctx.beginPath();ctx.arc(x,y,ring,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1;ctx.stroke();if(frac>0){ctx.beginPath();ctx.arc(x,y,ring,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.stroke();}if(kind==='irisBlur'||kind==='spinBlur')for(const [u,v] of [[1,0],[0,1],[-1,0],[0,-1]]){const p=irisPoint(source.width,source.height,pin,u,v);dot(ctx,p[0]*sx,p[1]*sy);}if(kind==='irisBlur'){const [u,v]=irisRoundHandle(pin),p=irisPoint(source.width,source.height,pin,u,v);ctx.strokeStyle='#fff';ctx.strokeRect(p[0]*sx-4,p[1]*sy-4,8,8);for(const [fu,fv] of irisFeatherHandles(pin)){const q=irisPoint(source.width,source.height,pin,fu,fv);dot(ctx,q[0]*sx,q[1]*sy);}}if(kind==='tiltShift'){const short=Math.max(1,Math.min(source.width,source.height)),reach=Math.hypot(source.width,source.height),focus=Number.isFinite(Number(pin.focus))?Number(pin.focus):.1,transition=Number.isFinite(Number(pin.transition))?Number(pin.transition):.15,stroke=(offset,dash)=>{const a=tiltPoint(source.width,source.height,pin,offset,-reach),b=tiltPoint(source.width,source.height,pin,offset,reach);ctx.beginPath();ctx.setLineDash(dash?[6,5]:[]);ctx.moveTo(a[0]*sx,a[1]*sy);ctx.lineTo(b[0]*sx,b[1]*sy);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);};stroke(focus*short,false);stroke(-focus*short,false);stroke((focus+transition)*short,true);stroke(-(focus+transition)*short,true);}}
  };
  let items=read(),drag=null,selected=0;
  canvas.onpointerdown=event=>{if(event.button!==0)return;items=read();const point=position(event),where=unit(point);
    if(kind==='pathBlur'){let best=null;items.forEach((path,pathIndex)=>path.points.forEach((node,pointIndex)=>{const distance=Math.hypot(node[0]*source.width-point[0],node[1]*source.height-point[1]);if(distance<12&&(!best||distance<best.distance))best={pathIndex,pointIndex,distance};}));if(best)drag=best;else{items[0].points.push(where);drag={pathIndex:0,pointIndex:items[0].points.length-1};}}
    else{const current=items[Math.min(selected,items.length-1)]||items[0],rect=canvas.getBoundingClientRect(),screen=p=>Math.hypot((p[0]-point[0])/source.width*rect.width,(p[1]-point[1])/source.height*rect.height),axis=(kind==='irisBlur'||kind==='spinBlur')?[[1,0],[0,1],[-1,0],[0,-1]].findIndex(([u,v])=>screen(irisPoint(source.width,source.height,current,u,v))<=9):-1,round=kind==='irisBlur'&&axis<0?screen(irisPoint(source.width,source.height,current,...irisRoundHandle(current)))<=9:false,feather=kind==='irisBlur'&&axis<0&&!round?irisFeatherHandles(current).findIndex(([u,v])=>screen(irisPoint(source.width,source.height,current,u,v))<=9):-1;if(axis>=0){selected=Math.min(selected,items.length-1);drag={kind:'axis',index:selected,axis};}else if(round){selected=Math.min(selected,items.length-1);drag={kind:'round',index:selected};}else if(feather>=0){selected=Math.min(selected,items.length-1);drag={kind:'feather',index:selected};}else{const dx=(current.x*source.width-point[0])/source.width*rect.width,dy=(current.y*source.height-point[1])/source.height*rect.height,radius=Math.hypot(dx,dy);if(Math.abs(radius-24)<=5){drag={kind:'ring',index:Math.min(selected,items.length-1),angle:Math.atan2(point[1]-current.y*source.height,point[0]-current.x*source.width),amount:kind==='spinBlur'?Number(current.blurAngle)||Number(numberField(body,'blurAngle')?.value)||0:kind==='tiltShift'?Number(current.blur)||Number(numberField(body,'blur')?.value)||0:Number(current.blur)||Number(numberField(body,'blur')?.value)||0};}else{const lineDistance=(at,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);return len<=1e-6?Math.hypot(at[0]-a[0],at[1]-a[1]):Math.abs((at[0]-a[0])*dy-(at[1]-a[1])*dx)/len;},toScreen=p=>[p[0]/source.width*rect.width,p[1]/source.height*rect.height],at=toScreen(point);let band=null;if(kind==='tiltShift'&&radius>9){const short=Math.max(1,Math.min(source.width,source.height)),reach=Math.hypot(source.width,source.height),focus=Number.isFinite(Number(current.focus))?Number(current.focus):.1,transition=Number.isFinite(Number(current.transition))?Number(current.transition):.15,near=offset=>lineDistance(at,toScreen(tiltPoint(source.width,source.height,current,offset,-reach)),toScreen(tiltPoint(source.width,source.height,current,offset,reach)))<=5;if(near(focus*short)||near(-focus*short))band='focus';else if(near((focus+transition)*short)||near(-(focus+transition)*short))band='transition';}if(band){selected=Math.min(selected,items.length-1);drag={kind:band,index:selected};}else{let best=0,distance=Infinity;items.forEach((pin,index)=>{const next=Math.hypot(pin.x*source.width-point[0],pin.y*source.height-point[1]);if(next<distance){distance=next;best=index;}});if(distance>12&&items.length<64&&kind!=='tiltShift'){items.push({...items[0],x:where[0],y:where[1]});best=items.length-1;}selected=best;drag={index:best,angle:kind==='tiltShift'&&distance>12};}}}}
    canvas.setPointerCapture(event.pointerId);paint(items);
  };
  canvas.onpointermove=event=>{if(!drag)return;const where=unit(position(event));
    if(kind==='pathBlur')items[drag.pathIndex].points[drag.pointIndex]=where;
    else if(drag.kind==='ring'){const pin=items[drag.index],point=position(event),angle=Math.atan2(point[1]-pin.y*source.height,point[0]-pin.x*source.width),next=ringAmount(drag.amount,drag.angle,angle,kind==='spinBlur'?360:500);drag.angle=next.angle;drag.amount=next.amount;if(kind==='spinBlur')items[drag.index]={...pin,blurAngle:next.amount};else if(kind!=='tiltShift')items[drag.index]={...pin,blur:next.amount};writeNumber(numberField(body,kind==='spinBlur'?'blurAngle':'blur'),next.amount);}
    else if(drag.kind==='axis'){const pin=items[drag.index],point=position(event),next=irisAxis(source.width,source.height,pin,point[0],point[1],drag.axis);items[drag.index]={...pin,...next};writeNumber(numberField(body,'radiusX'),next.radiusX);writeNumber(numberField(body,'radiusY'),next.radiusY);writeNumber(numberField(body,'angle'),next.angle);}
    else if(drag.kind==='round'){const pin=items[drag.index],point=position(event),roundness=irisRoundness(source.width,source.height,pin,point[0],point[1]);items[drag.index]={...pin,roundness};writeNumber(numberField(body,'roundness'),roundness);}
    else if(drag.kind==='feather'){const pin=items[drag.index],point=position(event),feather=irisFeather(source.width,source.height,pin,point[0],point[1]);items[drag.index]={...pin,feather};writeNumber(numberField(body,'feather'),feather);}
    else if(drag.kind==='focus'||drag.kind==='transition'){const pin=items[drag.index],point=position(event),band=tiltBand(source.width,source.height,pin,point[0],point[1],pin.focus);if(drag.kind==='focus'){items[drag.index]={...pin,focus:band.focus};writeNumber(numberField(body,'focus'),band.focus);}else{items[drag.index]={...pin,transition:band.transition};writeNumber(numberField(body,'transition'),band.transition);}}
    else if(drag.angle){const pin=items[drag.index];items[drag.index]={...pin,angle:Math.atan2(where[1]-pin.y,where[0]-pin.x)*180/Math.PI};}
    else items[drag.index]={...items[drag.index],x:where[0],y:where[1]};
    paint(items);
  };
  canvas.onpointerup=()=>{if(!drag)return;if(drag.kind==='ring')writeNumber(numberField(body,kind==='spinBlur'?'blurAngle':'blur'),drag.amount);drag=null;commit(items);paint(items);};
  canvas.tabIndex=0;canvas.addEventListener('keydown',event=>{if(kind==='pathBlur'||kind==='tiltShift'||drag)return;if(event.key!=='Delete'&&event.key!=='Backspace'||!items.length)return;event.preventDefault();const index=Math.min(selected,items.length-1);items=items.filter((_,i)=>i!==index);selected=items.length?Math.max(0,index-1):0;commit(items);paint(items);});
  body.addEventListener('input',event=>{if(event.target===canvas||drag)return;items=read();paint(items);});
  paint(items);
}

export function mountStraighten(body,source){
  const {canvas,scale,position}=preview(body,source);
  let start=null,end=null;
  const paint=()=>{const ctx=canvas.getContext('2d'),[sx,sy]=scale();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);if(!start||!end)return;ctx.beginPath();ctx.moveTo(start[0]*sx,start[1]*sy);ctx.lineTo(end[0]*sx,end[1]*sy);ctx.strokeStyle='#4ee0ff';ctx.lineWidth=2;ctx.stroke();dot(ctx,start[0]*sx,start[1]*sy);dot(ctx,end[0]*sx,end[1]*sy);};
  canvas.onpointerdown=event=>{if(event.button!==0)return;start=end=position(event);canvas.setPointerCapture(event.pointerId);paint();};
  canvas.onpointermove=event=>{if(!start)return;end=position(event);paint();};
  canvas.onpointerup=()=>{if(!start||!end)return;const angle=Math.atan2(end[1]-start[1],end[0]-start[0])*180/Math.PI;writeNumber(numberField(body,'angle'),angle);start=end=null;};
  paint();
}
