// Editable mesh deformation of the rendered text, without a compiled runtime.
import {createStyleWarp} from './warp-presets.js';
export function layoutWarpType(text,base){
  const b={x:base.bounds.x-2,y:base.bounds.y-2,w:base.bounds.w+4,h:base.bounds.h+4},warp=createStyleWarp(text,base.bounds),columns=64,rows=32,points=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const deform=(x,y)=>warp?warp.point(x,y):{x,y};
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const sx=b.w*column/columns,sy=b.h*row/rows,p=deform(b.x+sx,b.y+sy);points.push({...p,sx,sy});left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);
  }
  return{warp:true,base,sourceBounds:b,columns,rows,points,overflow:base.overflow,box:null,bounds:{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)}};
}
function triangle(ctx,source,a,b,c){
  const sx1=b.sx-a.sx,sy1=b.sy-a.sy,sx2=c.sx-a.sx,sy2=c.sy-a.sy,det=sx1*sy2-sx2*sy1;
  if(Math.abs(det)<1e-12)return;
  const dx1=b.x-a.x,dy1=b.y-a.y,dx2=c.x-a.x,dy2=c.y-a.y,m00=(dx1*sy2-dx2*sy1)/det,m01=(dy1*sy2-dy2*sy1)/det,m10=(dx2*sx1-dx1*sx2)/det,m11=(dy2*sx1-dy1*sx2)/det;
  ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.clip();ctx.transform(m00,m01,m10,m11,a.x-m00*a.sx-m10*a.sy,a.y-m01*a.sx-m11*a.sy);ctx.drawImage(source,0,0);ctx.restore();
}
export function renderWarpType(ctx,text,layout,renderBase){
  const b=layout.sourceBounds,width=Math.ceil(b.w),height=Math.ceil(b.h);
  if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The unwarped text exceeds the image size limit.');
  const source=document.createElement('canvas');source.width=width;source.height=height;
  renderBase(source,{...text,warpStyle:'none',matrix:[1,0,0,1,0,0],angle:0,scaleX:100,scaleY:100,skew:0},{offsetX:-b.x,offsetY:-b.y});
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const {columns,rows,points}=layout,stride=columns+1;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){const a=points[row*stride+column],b=points[row*stride+column+1],c=points[(row+1)*stride+column],d=points[(row+1)*stride+column+1];triangle(ctx,source,a,b,d);triangle(ctx,source,a,d,c);}
}
