export function tracePath(context,path,offsetX=0,offsetY=0){
  const nodes=path?.nodes||[];context.beginPath();if(!nodes.length)return;
  context.moveTo(nodes[0].x+offsetX,nodes[0].y+offsetY);
  const segment=(a,b)=>context.bezierCurveTo((a.outX??a.x)+offsetX,(a.outY??a.y)+offsetY,(b.inX??b.x)+offsetX,(b.inY??b.y)+offsetY,b.x+offsetX,b.y+offsetY);
  for(let i=1;i<nodes.length;i++)segment(nodes[i-1],nodes[i]);
  if(path.closed&&nodes.length>1){segment(nodes.at(-1),nodes[0]);context.closePath();}
}
export function pathBounds(path){
  if(!path?.nodes?.length)return{x:0,y:0,w:0,h:0};
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const node of path.nodes){for(const [x,y] of [[node.x,node.y],[node.inX??node.x,node.inY??node.y],[node.outX??node.x,node.outY??node.y]]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
  return{x:left,y:top,w:right-left,h:bottom-top};
}
export function transformPath(path,transform){
  for(const node of path.nodes){for(const [xKey,yKey] of [['x','y'],['inX','inY'],['outX','outY']]){
    if(node[xKey]==null||node[yKey]==null)continue;const point=transform(node[xKey],node[yKey]);node[xKey]=point.x;node[yKey]=point.y;
  }}return path;
}
export function rectanglePath(x,y,w,h){return{closed:true,nodes:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]};}
export function ellipsePath(x,y,w,h){
  const k=.5522847498307936,rx=w/2,ry=h/2,cx=x+rx,cy=y+ry;
  return{closed:true,nodes:[{x:cx+rx,y:cy,inX:cx+rx,inY:cy-k*ry,outX:cx+rx,outY:cy+k*ry},
    {x:cx,y:cy+ry,inX:cx+k*rx,inY:cy+ry,outX:cx-k*rx,outY:cy+ry},
    {x:cx-rx,y:cy,inX:cx-rx,inY:cy+k*ry,outX:cx-rx,outY:cy-k*ry},
    {x:cx,y:cy-ry,inX:cx-k*rx,inY:cy-ry,outX:cx+k*rx,outY:cy-ry}]};
}
export function pathData(path){
  const nodes=path.nodes||[];if(!nodes.length)return'';const n=value=>Number(value.toFixed(4)),point=node=>`${n(node.x)} ${n(node.y)}`;let data='M '+point(nodes[0]);
  const segment=(a,b)=>a.outX!=null||b.inX!=null?` C ${n(a.outX??a.x)} ${n(a.outY??a.y)} ${n(b.inX??b.x)} ${n(b.inY??b.y)} ${point(b)}`:` L ${point(b)}`;
  for(let i=1;i<nodes.length;i++)data+=segment(nodes[i-1],nodes[i]);if(path.closed){data+=segment(nodes.at(-1),nodes[0]);data+=' Z';}return data;
}
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function controls(a,b){return[a,{x:a.outX??a.x,y:a.outY??a.y},{x:b.inX??b.x,y:b.inY??b.y},b];}
export function pathPoint(a,b,t){const [p0,p1,p2,p3]=controls(a,b),q0=lerp(p0,p1,t),q1=lerp(p1,p2,t),q2=lerp(p2,p3,t);return lerp(lerp(q0,q1,t),lerp(q1,q2,t),t);}
export function nearestPathSegment(path,p,tolerance){let best=null;const count=path.closed?path.nodes.length:path.nodes.length-1;for(let i=0;i<count;i++){const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];let t=0,d=Infinity;for(let k=0;k<=32;k++){const q=pathPoint(a,b,k/32),distance=(q.x-p.x)**2+(q.y-p.y)**2;if(distance<d){d=distance;t=k/32;}}let span=1/32;for(let k=0;k<10;k++){for(const candidate of [Math.max(0,t-span),Math.min(1,t+span)]){const q=pathPoint(a,b,candidate),distance=(q.x-p.x)**2+(q.y-p.y)**2;if(distance<d){d=distance;t=candidate;}}span/=2;}if(d<=tolerance*tolerance&&(!best||d<best.distance))best={index:i,t,distance:d};}return best;}
export function splitPathSegment(path,index,t=.5){const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];if(!a||!b)return null;const straight=Math.hypot((a.outX??a.x)-a.x,(a.outY??a.y)-a.y)<1e-9&&Math.hypot((b.inX??b.x)-b.x,(b.inY??b.y)-b.y)<1e-9,point=pathPoint(a,b,t);if(straight){const node={...point,smooth:false};path.nodes.splice(index+1,0,node);return node;}const [p0,p1,p2,p3]=controls(a,b),q0=lerp(p0,p1,t),q1=lerp(p1,p2,t),q2=lerp(p2,p3,t),r0=lerp(q0,q1,t),r1=lerp(q1,q2,t);a.outX=q0.x;a.outY=q0.y;b.inX=q2.x;b.inY=q2.y;const node={...point,inX:r0.x,inY:r0.y,outX:r1.x,outY:r1.y,smooth:true};path.nodes.splice(index+1,0,node);return node;}
export function smoothAnchor(path,index){const node=path.nodes[index];if(!node)return;const previous=path.nodes[index-1]||(path.closed?path.nodes.at(-1):node),next=path.nodes[index+1]||(path.closed?path.nodes[0]:node),angle=Math.atan2(next.y-previous.y,next.x-previous.x),before=Math.hypot(node.x-previous.x,node.y-previous.y)/3,after=Math.hypot(next.x-node.x,next.y-node.y)/3;node.inX=node.x-Math.cos(angle)*before;node.inY=node.y-Math.sin(angle)*before;node.outX=node.x+Math.cos(angle)*after;node.outY=node.y+Math.sin(angle)*after;node.smooth=true;}
export function moveAnchor(node,base,dx,dy){for(const [x,y]of [['x','y'],['inX','inY'],['outX','outY']])if(base[x]!=null){node[x]=base[x]+dx;node[y]=base[y]+dy;}}
export function moveHandle(node,key,x,y,independent=false){const xKey=key==='in'?'inX':'outX',yKey=key==='in'?'inY':'outY',ox=key==='in'?'outX':'inX',oy=key==='in'?'outY':'inY',length=node[ox]==null?0:Math.hypot(node[ox]-node.x,node[oy]-node.y);node[xKey]=x;node[yKey]=y;if(independent)node.smooth=false;const d=Math.hypot(x-node.x,y-node.y);if(node.smooth&&length>1e-9&&d>1e-9){node[ox]=node.x-(x-node.x)/d*length;node[oy]=node.y-(y-node.y)/d*length;}}
export function bendPathSegment(path,index,t,dx,dy,bases){const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];for(const [node,base]of [[a,bases[0]],[b,bases[1]]]){for(const key of ['inX','inY','outX','outY'])if(base[key]==null)delete node[key];Object.assign(node,base);}const straight=Math.hypot((a.outX??a.x)-a.x,(a.outY??a.y)-a.y)<1e-9&&Math.hypot((b.inX??b.x)-b.x,(b.inY??b.y)-b.y)<1e-9;if(straight){moveAnchor(a,bases[0],dx,dy);moveAnchor(b,bases[1],dx,dy);return;}t=Math.max(.05,Math.min(.95,t));const u=1-t,s=1/(3*t*u*(u*u+t*t));moveHandle(a,'out',(a.outX??a.x)+dx*u*s,(a.outY??a.y)+dy*u*s);moveHandle(b,'in',(b.inX??b.x)+dx*t*s,(b.inY??b.y)+dy*t*s);}
export function selectionPaths(selection){
  if(!selection)return[];if(selection.kind==='path')return[structuredClone(selection.path)];
  if(selection.kind==='ellipse')return[ellipsePath(selection.x,selection.y,selection.w,selection.h)];
  if(selection.kind==='lasso')return[{closed:true,nodes:selection.points.map(point=>({...point}))}];
  if(!['mask','alpha'].includes(selection.kind))return[rectanglePath(selection.x,selection.y,selection.w,selection.h)];
  const rows=new Map();for(const [y,start,end]of selection.runs){if(!rows.has(y))rows.set(y,[]);rows.get(y).push([start,end]);}
  const edges=new Map();let count=0;const key=(x,y)=>x+','+y,edge=(x,y,nx,ny)=>{const k=key(x,y);if(!edges.has(k))edges.set(k,[]);edges.get(k).push({x:nx,y:ny});count++;if(count>200000)throw Error('This selection has too many boundary points to convert into a path.');};
  const exposed=(start,end,neighbors,action)=>{let cursor=start;for(const [a,b]of neighbors||[]){if(b<=cursor)continue;if(a>=end)break;for(let x=cursor;x<Math.min(a,end);x++)action(x);cursor=Math.max(cursor,b);if(cursor>=end)break;}for(let x=cursor;x<end;x++)action(x);};
  for(const [y,start,end]of selection.runs){edge(start,y+1,start,y);edge(end,y,end,y+1);exposed(start,end,rows.get(y-1),x=>edge(x,y,x+1,y));exposed(start,end,rows.get(y+1),x=>edge(x+1,y+1,x,y+1));}
  const paths=[];while(edges.size){const first=edges.keys().next().value,[x,y]=first.split(',').map(Number),nodes=[{x,y}];let current=first,guard=0;
    do{const outgoing=edges.get(current);if(!outgoing?.length)break;const point=outgoing.pop();if(!outgoing.length)edges.delete(current);current=key(point.x,point.y);if(current!==first)nodes.push(point);guard++;}while(current!==first&&guard<=count);
    if(nodes.length>=3){const simplified=nodes.filter((node,i)=>{const prev=nodes[(i+nodes.length-1)%nodes.length],next=nodes[(i+1)%nodes.length];return(prev.x-node.x)*(next.y-node.y)!==(prev.y-node.y)*(next.x-node.x);});paths.push({closed:current===first,nodes:simplified});}
  }return paths;
}
