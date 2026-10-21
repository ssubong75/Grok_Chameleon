// PhotoCraft bake_components: flatten, 4× area coverage, trace the 0.5 contour, scale back.
import {shapeContours} from './shape-combine.js';
import {createRasterizer,pushComponent,sortEdges,renderCoverage} from './shape-raster.js';
import {traceMask} from './shape-trace.js';
const point=(node,xKey,yKey)=>({x:node[xKey]??node.x,y:node[yKey]??node.y});
function segments(contour){const nodes=contour.nodes||[],n=nodes.length;if(n<2)return [];const count=contour.closed===false?n-1:n,out=[];for(let i=0;i<count;i++){const a=nodes[i],b=nodes[(i+1)%n];out.push([point(a,'x','y'),point(a,'outX','outY'),point(b,'inX','inY'),point(b,'x','y')]);}return out;}
function isLine(seg){const [p0,c1,c2,p1]=seg,dx=p1.x-p0.x,dy=p1.y-p0.y,len2=dx*dx+dy*dy;const on=c=>{const vx=c.x-p0.x,vy=c.y-p0.y;if(len2<1e-24)return Math.abs(vx)<1e-9&&Math.abs(vy)<1e-9;const t=(vx*dx+vy*dy)/len2,cross=Math.abs(vx*dy-vy*dx)/Math.sqrt(len2);return cross<1e-9&&t>=-1e-9&&t<=1+1e-9;};return on(c1)&&on(c2);}
function pieces(seg,tol){const [p0,c1,c2,p1]=seg,d1=Math.hypot(p0.x-2*c1.x+c2.x,p0.y-2*c1.y+c2.y),d2=Math.hypot(c1.x-2*c2.x+p1.x,c1.y-2*c2.y+p1.y),m=Math.max(d1,d2),size=Math.hypot(c1.x-p0.x,c1.y-p0.y)+Math.hypot(c2.x-c1.x,c2.y-c1.y)+Math.hypot(p1.x-c2.x,p1.y-c2.y),limit=Math.max(1e-4,Math.min(tol,size*1e-3)),n=Math.ceil(Math.sqrt(.75*m/limit));return Number.isFinite(n)?Math.max(1,Math.min(1<<16,n)):1;}
function evalSeg(seg,t){const [p0,c1,c2,p1]=seg,mt=1-t,a=mt*mt*mt,b=3*mt*mt*t,c=3*mt*t*t,d=t*t*t;return {x:a*p0.x+b*c1.x+c*c2.x+d*p1.x,y:a*p0.y+b*c1.y+c*c2.y+d*p1.y};}
function flattenContour(contour,tol){const pts=[];const push=p=>{const last=pts.at(-1);if(last&&Math.abs(last.x-p.x)<1e-12&&Math.abs(last.y-p.y)<1e-12)return;pts.push(p);};const nodes=contour.nodes||[];if(nodes[0])push(point(nodes[0],'x','y'));for(const seg of segments(contour)){if(isLine(seg)){push(seg[3]);continue;}const n=pieces(seg,tol);for(let j=1;j<=n;j++)push(evalSeg(seg,j/n));}if(contour.closed!==false&&pts.length>1){const a=pts[0],b=pts.at(-1);if(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12)pts.pop();}return pts;}
function scaleNode(node,k){const next={...node};for(const [x,y]of [['x','y'],['inX','inY'],['outX','outY']])if(next[x]!=null&&next[y]!=null){next[x]*=k;next[y]*=k;}return next;}
function scaleContour(contour,k){return {...contour,nodes:(contour.nodes||[]).map(node=>scaleNode(node,k))};}
function scalePath(path,k){const contours=shapeContours(path).map(contour=>scaleContour(contour,k));if(!contours.length)return {nodes:[],closed:true,op:'combine',subpaths:[],fillRule:path.fillRule||'nonzero'};const [first,...subpaths]=contours;return {...first,subpaths,fillRule:path.fillRule||'nonzero'};}
function emptyPath(rule){return {nodes:[],closed:true,op:'combine',subpaths:[],fillRule:rule||'nonzero'};}
export function bakeShapePath(path,tolerance=.1){
  const tol=Math.max(.05,Math.min(10,Number.isFinite(Number(tolerance))?Number(tolerance):.1)),K=4,rule=path?.fillRule==='evenodd'?'evenodd':'nonzero';
  const contours=shapeContours(path).map(contour=>scaleContour(contour,K));
  if(!contours.length)return emptyPath(rule);
  const raster=createRasterizer(false);let polys=[],op='combine';
  const flush=()=>{if(!polys.length)return;pushComponent(raster,polys,op,rule);polys=[];};
  contours.forEach((contour,index)=>{const next=index===0?'combine':contour.op||'combine';if(next==='join'&&polys.length)polys.push(flattenContour(contour,.01));else{flush();op=next==='join'?'combine':next;polys=[flattenContour(contour,.01)];}});
  flush();sortEdges(raster);
  const box=raster.bounds;if(!box)return emptyPath(rule);
  let x0=Math.floor(box[0]),y0=Math.floor(box[1]),x1=Math.ceil(box[2])+1,y1=Math.ceil(box[3])+1;
  x0-=2;y0-=2;x1+=2;y1+=2;
  const width=x1-x0,height=y1-y0;
  if(width<=0||height<=0)return emptyPath(rule);
  if(width*height>400000000)throw Error('shape too large to merge');
  const traced=traceMask(renderCoverage(raster,x0,y0,x1,y1),width,height,x0,y0,0,tol*K);
  return scalePath(traced,1/K);
}
