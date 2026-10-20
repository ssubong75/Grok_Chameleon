// PhotoCraft segment/mod.rs sampling and boundary refinement, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {gridCut} from './segment-cut.js';
export const segmentRgb=(data,i)=>{const a=data[i+3]/255;return[data[i]/255*a+.5*(1-a),data[i+1]/255*a+.5*(1-a),data[i+2]/255*a+.5*(1-a)];};
export function scaledSegmentImage(image,budget,bounds={x:0,y:0,w:image.width,h:image.height},fixedStep=null){
  const {x,y,w,h}=bounds,step=fixedStep||Math.max(1,Math.ceil(Math.sqrt(w*h/budget))),width=Math.ceil(w/step),height=Math.ceil(h/step),pixels=new Array(width*height);
  for(let oy=0;oy<height;oy++)for(let ox=0;ox<width;ox++){const sum=[0,0,0];let n=0;for(let yy=oy*step;yy<Math.min(h,(oy+1)*step);yy++)for(let xx=ox*step;xx<Math.min(w,(ox+1)*step);xx++){const p=segmentRgb(image.data,((y+yy)*image.width+x+xx)*4);for(let c=0;c<3;c++)sum[c]+=p[c];n++;}pixels[oy*width+ox]=sum.map(v=>v/n);}
  return{pixels,width,height,step,bounds};
}
export function finishSegment(image,low,scaled,fg,bg){
  const {step,width:lw,height:lh,bounds}=scaled,{x:ox,y:oy,w,h}=bounds,mask=new Uint8ClampedArray(w*h),band=new Uint8Array(lw*lh),block=(x,y)=>Math.min(lh-1,Math.floor(y/step))*lw+Math.min(lw-1,Math.floor(x/step));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=low[block(x,y)]?255:0;
  if(step>1){
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){const i=y*lw+x;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<lw&&yy<lh&&low[yy*lw+xx]!==low[i])band[i]=1;}}
    for(let ty=0;ty<h;ty+=192)for(let tx=0;tx<w;tx+=192){
      const tw=Math.min(192,w-tx),th=Math.min(192,h-ty);let mixed=false;for(let y=Math.floor(ty/step);y<=Math.floor((ty+th-1)/step)&&!mixed;y++)for(let x=Math.floor(tx/step);x<=Math.floor((tx+tw-1)/step);x++)if(band[y*lw+x]){mixed=true;break;}if(!mixed)continue;
      const left=Math.max(0,tx-12),top=Math.max(0,ty-12),right=Math.min(w,tx+tw+12),bottom=Math.min(h,ty+th+12),ww=right-left,hh=bottom-top,pixels=new Array(ww*hh),fixed=new Uint8Array(ww*hh),cf=new Float32Array(ww*hh),cb=new Float32Array(ww*hh);
      for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){const i=y*ww+x,b=block(left+x,top+y),label=low[b],p=segmentRgb(image.data,((oy+top+y)*image.width+ox+left+x)*4);pixels[i]=p;if(!band[b])fixed[i]=label?1:2;else{cf[i]=fg.negativeLog(p)+(label?0:.4);cb[i]=bg.negativeLog(p)+(label ? .4 : 0);}}
      const cut=gridCut(pixels,ww,hh,cf,cb,fixed);for(let y=0;y<th;y++)for(let x=0;x<tw;x++)mask[(ty+y)*w+tx+x]=cut[(ty+y-top)*ww+tx+x-left]?255:0;
    }
  }
  const source=new Uint8ClampedArray(mask);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,v=source[i];let sum=0,edge=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,n=xx<0||yy<0||xx>=w||yy>=h?v:source[yy*w+xx];sum+=n;if(n!==v)edge=true;}if(edge)mask[i]=Math.round((v>127 ? .5 : 0)*255+sum/18);
  }
  if(!ox&&!oy&&w===image.width&&h===image.height)return mask;
  const output=new Uint8ClampedArray(image.width*image.height);for(let y=0;y<h;y++)output.set(mask.subarray(y*w,(y+1)*w),(oy+y)*image.width+ox);return output;
}
