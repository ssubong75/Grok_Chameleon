import {quadMapping} from './perspective.js';
import {createStyleWarp,warpStyles} from './warp-presets.js';
import {meshPoint} from './psd-smart.js';
// Forward mesh rasterization of a placed warp. The homography maps the source-space frame
// (custom control box, otherwise the source rectangle) onto the PSD corner quad.
function project(mapping,point){const w=mapping[6]*point.x+mapping[7]*point.y+1;if(!Number.isFinite(w)||Math.abs(w)<1e-10)return null;return{x:(mapping[0]*point.x+mapping[1]*point.y+mapping[2])/w,y:(mapping[3]*point.x+mapping[4]*point.y+mapping[5])/w};}
function sourceMapper(spec,width,height){
  if(spec.mesh){const domain=spec.domain||{x:0,y:0,width,height};if(![domain.x,domain.y,domain.width,domain.height].every(Number.isFinite)||domain.width<=0||domain.height<=0)throw Error('The warp source domain is invalid.');return(x,y)=>meshPoint(spec.mesh,(x-domain.x)/domain.width,(y-domain.y)/domain.height);}
  const bounds=spec.bounds||spec.frame,warp=createStyleWarp({warpStyle:spec.style,warpBend:spec.bend,warpHorizontal:spec.horizontal,warpVertical:spec.vertical,warpAxis:spec.axis},{x:bounds.x,y:bounds.y,w:bounds.width,h:bounds.height});
  return warp?(x,y)=>warp.point(x,y):(x,y)=>({x,y});
}
export function smartWarpOperation(width,height,settings={}){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('the smart object has no pixels');const style=settings.style;if(!style&&!settings.mesh)throw Error('pass `style` (arc, flag, …, custom), `mesh` or `warp`');if(style==='none')return null;const frame={x:0,y:0,width,height},quad=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],base={type:'warpPlace',frame,quad,bounds:frame,domain:frame,interpolation:settings.interpolation==='nearest'||settings.interpolation==='bilinear'?settings.interpolation:'bicubic'};if(style==='custom'||settings.mesh){const mesh=settings.mesh;if(!mesh?.us||!mesh?.vs||!Array.isArray(mesh.points))throw Error('malformed mesh (need (3·cols+1)×(3·rows+1) points and knots 0..1)');return {...base,mesh};}if(!warpStyles.some(([id])=>id===style))throw Error('unknown warp style "'+style+'"');const bend=Number.isFinite(Number(settings.bend))?Number(settings.bend):50,horizontal=Number(settings.hDistort)||0,verticalDistort=Number(settings.vDistort)||0,axis=settings.vertical?'vertical':'horizontal';if(!createStyleWarp({warpStyle:style,warpBend:bend,warpHorizontal:horizontal,warpVertical:verticalDistort,warpAxis:axis},{x:0,y:0,w:width,h:height}))return null;return {...base,style,bend,horizontal,vertical:verticalDistort,axis};}
export function warpPlaceBounds(width,height,spec,includeGrid=false){
  const frame=spec.frame,quad=spec.quad;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!frame||!(frame.width>0)||!(frame.height>0)||!Array.isArray(quad)||quad.length!==4)throw Error('The placed warp is incomplete.');
  const mapping=quadMapping([{x:frame.x,y:frame.y},{x:frame.x+frame.width,y:frame.y},{x:frame.x+frame.width,y:frame.y+frame.height},{x:frame.x,y:frame.y+frame.height}],quad);
  const sourcePoint=sourceMapper(spec,width,height),mapPoint=(x,y)=>project(mapping,sourcePoint(x,y)),probe=[];
  for(let row=0;row<=16;row++)for(let column=0;column<=16;column++)probe.push(mapPoint(width*column/16,height*row/16));
  const step=(a,b)=>{if(!a||!b)return 0;const distance=Math.hypot(b.x-a.x,b.y-a.y);return Number.isFinite(distance)?distance:0;};let lengthX=0,lengthY=0;
  for(let k=0;k<=16;k++){let horizontal=0,vertical=0;for(let m=1;m<=16;m++){horizontal+=step(probe[k*17+m-1],probe[k*17+m]);vertical+=step(probe[(m-1)*17+k],probe[m*17+k]);}lengthX=Math.max(lengthX,horizontal);lengthY=Math.max(lengthY,vertical);}
  const columns=Math.min(512,Math.max(1,Math.ceil(Math.max(width,lengthX)/4))),rows=Math.min(512,Math.max(1,Math.ceil(Math.max(height,lengthY)/4))),grid=[];
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const sx=width*column/columns,sy=height*row/rows,dest=mapPoint(sx,sy);
    if(!dest||!Number.isFinite(dest.x)||!Number.isFinite(dest.y))throw Error('The warp does not map to finite coordinates.');
    minX=Math.min(minX,dest.x);minY=Math.min(minY,dest.y);maxX=Math.max(maxX,dest.x);maxY=Math.max(maxY,dest.y);if(includeGrid)grid.push({sx,sy,dest});
  }
  for(const point of quad){minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
  const originX=Math.floor(minX),originY=Math.floor(minY),outWidth=Math.ceil(maxX)-originX,outHeight=Math.ceil(maxY)-originY;
  if(outWidth<1||outHeight<1||outWidth>32767||outHeight>32767||outWidth*outHeight>64000000)throw Error('The warped layer exceeds the image size limit.');
  return{x:originX,y:originY,width:outWidth,height:outHeight,...(includeGrid?{grid,columns,rows}:{})};
}
export function warpPlacePixels(image,spec){
  const {width,height,data}=image,{x:originX,y:originY,width:outWidth,height:outHeight,grid,columns,rows}=warpPlaceBounds(width,height,spec,true);
  const output=new Uint8ClampedArray(outWidth*outHeight*4),at=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return[0,0,0,0];const index=(y*width+x)*4;return[data[index],data[index+1],data[index+2],data[index+3]];};
  const cubic=t=>{const a=-.75,near=x=>(a+2)*x*x*x-(a+3)*x*x+1,far=x=>a*(x*x*x-5*x*x+8*x-4);return[far(1+t),near(t),near(1-t),far(2-t)];};
  const point=(sx,sy,bilinear=false)=>{const snap=v=>Math.abs(v-Math.round(v))<1e-7?Math.round(v):v;sx=snap(sx);sy=snap(sy);const left=Math.floor(sx),top=Math.floor(sy),fx=sx-left,fy=sy-top,wx=bilinear?[1-fx,fx]:cubic(fx),wy=bilinear?[1-fy,fy]:cubic(fy),offset=bilinear?0:-1,sums=[0,0,0];let alpha=0;
    for(let y=0;y<wy.length;y++)for(let x=0;x<wx.length;x++){const weight=wx[x]*wy[y];if(!weight)continue;const pixel=at(left+x+offset,top+y+offset),coverage=pixel[3]/255*weight;alpha+=coverage;for(let channel=0;channel<3;channel++)sums[channel]+=pixel[channel]*coverage;}return{color:sums,alpha};};
  const sample=(sx,sy,jx,jy,nx,ny)=>{const method=spec.interpolation==='nearest'?'nearest':spec.interpolation==='bilinear'?'bilinear':'bicubic';if(method==='nearest'){const pixel=at(Math.round(sx-.5),Math.round(sy-.5)),coverage=pixel[3]/255;return {color:pixel.slice(0,3).map(v=>v*coverage),alpha:coverage};}if(nx*ny===1)return point(sx-.5,sy-.5,method==='bilinear');const result={color:[0,0,0],alpha:0};for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const s=(x+.5)/nx-.5,t=(y+.5)/ny-.5,value=point(sx+s*jx[0]+t*jy[0]-.5,sy+s*jx[1]+t*jy[1]-.5,true);result.alpha+=value.alpha;for(let c=0;c<3;c++)result.color[c]+=value.color[c];}const total=nx*ny;result.alpha/=total;for(let c=0;c<3;c++)result.color[c]/=total;return result;};
  const paint=(a,b,c)=>{const det=(b.dest.x-a.dest.x)*(c.dest.y-a.dest.y)-(c.dest.x-a.dest.x)*(b.dest.y-a.dest.y);if(Math.abs(det)<1e-12)return;const d1=[b.sx-a.sx,b.sy-a.sy],d2=[c.sx-a.sx,c.sy-a.sy],l1x=(c.dest.y-a.dest.y)/det,l1y=(a.dest.x-c.dest.x)/det,l2x=(a.dest.y-b.dest.y)/det,l2y=(b.dest.x-a.dest.x)/det,cap=j=>{const length=Math.hypot(...j);return length>8?j.map(v=>v*8/length):j;},jx=cap([l1x*d1[0]+l2x*d2[0],l1x*d1[1]+l2x*d2[1]]),jy=cap([l1y*d1[0]+l2y*d2[0],l1y*d1[1]+l2y*d2[1]]),nx=Math.max(1,Math.min(8,Math.round(Math.hypot(...jx)))),ny=Math.max(1,Math.min(8,Math.round(Math.hypot(...jy))));const x0=Math.max(0,Math.floor(Math.min(a.dest.x,b.dest.x,c.dest.x)-originX)),x1=Math.min(outWidth,Math.ceil(Math.max(a.dest.x,b.dest.x,c.dest.x)-originX)),y0=Math.max(0,Math.floor(Math.min(a.dest.y,b.dest.y,c.dest.y)-originY)),y1=Math.min(outHeight,Math.ceil(Math.max(a.dest.y,b.dest.y,c.dest.y)-originY));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const px=originX+x+.5,py=originY+y+.5,l1=((px-a.dest.x)*(c.dest.y-a.dest.y)-(c.dest.x-a.dest.x)*(py-a.dest.y))/det,l2=((b.dest.x-a.dest.x)*(py-a.dest.y)-(px-a.dest.x)*(b.dest.y-a.dest.y))/det,l0=1-l1-l2;if(l0<-1e-9||l1<-1e-9||l2<-1e-9)continue;const sampled=sample(l0*a.sx+l1*b.sx+l2*c.sx,l0*a.sy+l1*b.sy+l2*c.sy,jx,jy,nx,ny),index=(y*outWidth+x)*4;const alpha=Math.max(0,Math.min(1,sampled.alpha));if(alpha<=1e-6){output.fill(0,index,index+4);continue;}for(let channel=0;channel<3;channel++)output[index+channel]=sampled.color[channel]/alpha;output[index+3]=alpha*255;}};
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){const index=row*(columns+1)+column,a=grid[index],b=grid[index+1],c=grid[index+columns+1],d=grid[index+columns+2];paint(a,b,d);paint(a,d,c);}
  return{x:originX,y:originY,width:outWidth,height:outHeight,data:output};
}
