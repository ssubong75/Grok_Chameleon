// PhotoCraft segment/quick.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {gridCut} from './segment-cut.js';
import {scaledSegmentImage} from './segment-image.js';
import {selectionDistance} from './selection-distance.js';
import {bilinear} from './photo-math.js';
const distanceTo= (flags,w,h)=>selectionDistance(Uint8Array.from(flags,v=>v?255:0),w,h);
function strokeMask(points,radius,w,h){
  const mask=new Uint8Array(w*h),segments=points.length===1?[[points[0],points[0]]]:points.slice(1).map((p,i)=>[points[i],p]);
  for(const [a,b]of segments){
    const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius)),y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius)),x1=Math.min(w,Math.max(0,Math.ceil(Math.max(a.x,b.x)+radius))),y1=Math.min(h,Math.max(0,Math.ceil(Math.max(a.y,b.y)+radius))),dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const px=x+.5,py=y+.5,t=len?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/len)):0;if((a.x+t*dx-px)**2+(a.y+t*dy-py)**2<=radius*radius)mask[y*w+x]=1;}
  }
  for(const p of points)if(p.x>=0&&p.y>=0&&p.x<w&&p.y<h)mask[Math.floor(p.y)*w+Math.floor(p.x)]=1;return mask;
}
function cutLevels(pixels,w,h,fixed,cost,scale=1){
  const weight=d2=>scale*(.018847+1/(1+(Math.sqrt(d2)/.048450)**1.98549)),zeros=new Float32Array(w*h);
  if(w*h<=300000||w<8||h<8)return gridCut(pixels,w,h,cost,zeros,fixed,0,weight);
  const cw=Math.ceil(w/2),ch=Math.ceil(h/2),coarsePixels=Array.from({length:cw*ch},()=>[0,0,0]),counts=new Uint8Array(cw*ch),coarseFixed=new Uint8Array(cw*ch),coarseCost=new Float32Array(cw*ch);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,c=Math.floor(y/2)*cw+Math.floor(x/2);for(let k=0;k<3;k++)coarsePixels[c][k]+=pixels[i][k];counts[c]++;coarseCost[c]+=cost[i];if(fixed[i]===1)coarseFixed[c]=1;}
  for(let i=0;i<coarsePixels.length;i++)for(let k=0;k<3;k++)coarsePixels[i][k]/=counts[i];const coarse=cutLevels(coarsePixels,cw,ch,coarseFixed,coarseCost,scale*2),projected=Uint8Array.from(fixed,(_,i)=>coarse[Math.floor(Math.floor(i/w)/2)*cw+Math.floor((i%w)/2)]),edge=new Uint8Array(w*h);let any=false;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=projected[i];if(x&&projected[i-1]!==v||x+1<w&&projected[i+1]!==v||y&&projected[i-w]!==v||y+1<h&&projected[i+w]!==v){edge[i]=1;any=true;}}
  if(!any)return projected.map((v,i)=>v||fixed[i]===1?1:0);const near=distanceTo(edge,w,h),banded=Uint8Array.from(fixed,(v,i)=>v===1?1:near[i]<=3?0:projected[i]?1:2);return gridCut(pixels,w,h,cost,zeros,banded,0,weight);
}
export function quickSelect(image,settings={}){
  const {width:w,height:h}=image,points=settings.points,size=Number(settings.size);if(!Array.isArray(points)||!points.length||points.length>20000||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||!Number.isFinite(size)||size<1||size>1000)throw Error('Invalid Quick Selection stroke.');
  const radius=size/2,step=w*h<=512*512?1:2,rw=radius/step;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){x0=Math.min(x0,p.x-radius);y0=Math.min(y0,p.y-radius);x1=Math.max(x1,p.x+radius);y1=Math.max(y1,p.y+radius);}x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(w,Math.ceil(x1)+1);y1=Math.min(h,Math.ceil(y1)+1);if(x0>=x1||y0>=y1)throw Error('The brush stroke is outside the canvas.');
  let margin=Math.floor(Math.max(48,2*rw))*step;
  for(;;){
    const x=Math.floor(Math.max(0,x0-margin)/step)*step,y=Math.floor(Math.max(0,y0-margin)/step)*step,right=Math.min(w,x1+margin),bottom=Math.min(h,y1+margin),bounds={x,y,w:right-x,h:bottom-y};
    const {pixels,width:lw,height:lh}=scaledSegmentImage(image,1,bounds,step),seeds=strokeMask(points.map(p=>({x:(p.x-x)/step,y:(p.y-y)/step})),Math.max(.5,rw),lw,lh);if(!seeds.some(Boolean))throw Error('The brush stroke is outside the canvas.');
    const distance=distanceTo(seeds,lw,lh),grow=Math.max(0,1.69371+.103003*rw),cost=distance.map(d=>.004079*(1+.002651*Math.max(0,d-grow)**.98885)),fixed=Uint8Array.from(distance,d=>d<=grow?1:0),low=cutLevels(pixels,lw,lh,fixed,cost);let touches=false;
    if(x>0)for(let yy=0;yy<lh;yy++)if(low[yy*lw])touches=true;if(y>0)for(let xx=0;xx<lw;xx++)if(low[xx])touches=true;if(right<w)for(let yy=0;yy<lh;yy++)if(low[yy*lw+lw-1])touches=true;if(bottom<h)for(let xx=0;xx<lw;xx++)if(low[(lh-1)*lw+xx])touches=true;
    if(touches){margin*=2;continue;}
    const output=new Uint8ClampedArray(w*h),field=Float32Array.from(low);for(let yy=0;yy<bounds.h;yy++)for(let xx=0;xx<bounds.w;xx++)output[(y+yy)*w+x+xx]=step===1?(low[yy*lw+xx]?255:0):Math.round(255*bilinear(field,lw,lh,(xx+.5)/step-.5,(yy+.5)/step-.5));return output;
  }
}
