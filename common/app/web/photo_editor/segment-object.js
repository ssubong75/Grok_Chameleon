// PhotoCraft segment/grabcut.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {fitColorModel,subsample,cleanSegment,fillModelHoles,keepSeeded} from './segment-model.js';
import {contrastBeta,gridCut} from './segment-cut.js';
import {scaledSegmentImage,finishSegment} from './segment-image.js';
import {segmentLab} from './segment-saliency.js';
export function grabCut(pixels,w,h,trimap,iterations=6){
  const beta=contrastBeta(pixels,w,h),fixed=Uint8Array.from(trimap,t=>t===1?1:t===0?2:0);let fg=null,bg=null;
  for(let iter=0;iter<iterations;iter++){
    const fs=[],bs=[];for(let i=0;i<pixels.length;i++)(trimap[i]===1||trimap[i]===3?fs:bs).push(pixels[i]);const foreground=subsample(fs,40000),background=subsample(bs,40000);
    fg=fg?(fg.refit(foreground)||fg):fitColorModel(foreground,5,2e-5);bg=bg?(bg.refit(background)||bg):fitColorModel(background,5,2e-5);if(!fg||!bg)return null;
    const cf=Float32Array.from(pixels,p=>fg.negativeLog(p)),cb=Float32Array.from(pixels,p=>bg.negativeLog(p)),cut=gridCut(pixels,w,h,cf,cb,fixed,beta);let changed=0;
    for(let i=0;i<trimap.length;i++)if(trimap[i]===2||trimap[i]===3){const value=cut[i]?3:2;if(value!==trimap[i])changed++;trimap[i]=value;}if(changed*2000<trimap.length)break;
  }return{fg,bg};
}
export function selectObject(image,settings){
  const {width:w,height:h}=image,left=Math.max(0,Math.floor(Number(settings.x))),top=Math.max(0,Math.floor(Number(settings.y))),right=Math.min(w,Math.ceil(Number(settings.x)+Number(settings.width))),bottom=Math.min(h,Math.ceil(Number(settings.y)+Number(settings.height)));
  if(![left,top,right,bottom].every(Number.isFinite)||right-left<2||bottom-top<2)throw Error('Choose an object rectangle at least 2 × 2 pixels inside the canvas.');
  const margin=Math.max(8,Math.ceil(Math.max(right-left,bottom-top)*.15)),x=Math.max(0,left-margin),y=Math.max(0,top-margin),bounds={x,y,w:Math.min(w,right+margin)-x,h:Math.min(h,bottom+margin)-y},scaled=scaledSegmentImage(image,110000,bounds),{pixels,width:lw,height:lh,step}=scaled,trimap=new Uint8Array(lw*lh);let anyBackground=false;
  for(let yy=0;yy<lh;yy++)for(let xx=0;xx<lw;xx++){const cx=x+xx*step+Math.floor(step/2),cy=y+yy*step+Math.floor(step/2),inside=cx>=left&&cx<right&&cy>=top&&cy<bottom;trimap[yy*lw+xx]=inside?3:0;if(!inside)anyBackground=true;}
  if(!anyBackground){const ring=Math.max(1,Math.floor(Math.min(lw,lh)/50));for(let yy=0;yy<lh;yy++)for(let xx=0;xx<lw;xx++)if(xx<ring||yy<ring||xx+ring>=lw||yy+ring>=lh)trimap[yy*lw+xx]=0;}
  const models=grabCut(pixels,lw,lh,trimap,8);if(!models)throw Error('The object and background could not be separated. Try a tighter rectangle.');
  const {fg,bg}=models,clean=cleanSegment(Uint8Array.from(trimap,t=>t===1||t===3?1:0),lw,lh,.1,0),low=fillModelHoles(clean,pixels,lw,lh,fg,bg);if(!low.some(Boolean))throw Error('No object was found inside the rectangle.');return finishSegment(image,low,scaled,fg,bg);
}
function blurThree(pixels,w,h){
  const output=new Array(pixels.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sum=[0,0,0];let n=0;for(let yy=Math.max(0,y-1);yy<Math.min(h,y+2);yy++)for(let xx=Math.max(0,x-1);xx<Math.min(w,x+2);xx++){const p=pixels[yy*w+xx];for(let c=0;c<3;c++)sum[c]+=p[c];n++;}output[y*w+x]=sum.map(v=>v/n);}return output;
}
export function selectObjectAt(image,settings){
  const px=Math.floor(Number(settings.x)),py=Math.floor(Number(settings.y));if(!Number.isFinite(px)||!Number.isFinite(py)||px<0||py<0||px>=image.width||py>=image.height||image.width<4||image.height<4)throw Error('Click an object inside the canvas.');
  const scaled=scaledSegmentImage(image,60000),{pixels,width:w,height:h,step}=scaled,lab=blurThree(blurThree(pixels,w,h),w,h).map(segmentLab),sx=Math.min(w-1,Math.floor(px/step)),sy=Math.min(h-1,Math.floor(py/step)),grown=new Uint8Array(w*h),stack=new Uint32Array(w*h),seed=sy*w+sx,sum=[...lab[seed]],distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);let count=1,n=1;stack[0]=seed;grown[seed]=1;
  while(count){const i=stack[--count],x=i%w,y=Math.floor(i/w),color=lab[i],mean=sum.map(v=>v/n);for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1]){if(j<0||grown[j])continue;const q=lab[j];if(distance(q,color)<=10&&distance(q,mean)<=32){grown[j]=1;for(let c=0;c<3;c++)sum[c]+=q[c];n++;stack[count++]=j;}}}
  if(n*10>w*h*6||n<4)throw Error('No distinct object was found at this point. Drag a rectangle around the object instead.');
  let x0=w,y0=h,x1=0,y1=0;for(let i=0;i<grown.length;i++)if(grown[i]){const x=i%w,y=Math.floor(i/w);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}const pad=Math.max(2,Math.floor(Math.max(x1-x0,y1-y0)/6)),bx0=Math.max(0,x0-pad),by0=Math.max(0,y0-pad),bx1=Math.min(w,x1+pad),by1=Math.min(h,y1+pad),trimap=new Uint8Array(w*h);let anyBackground=false;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,inside=x>=bx0&&x<bx1&&y>=by0&&y<by1;trimap[i]=grown[i]?3:inside?2:0;if(!inside)anyBackground=true;}
  if(!anyBackground)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((!x||!y||x+1===w||y+1===h)&&!(x===sx&&y===sy))trimap[y*w+x]=0;trimap[seed]=1;
  const models=grabCut(pixels,w,h,trimap,5);if(!models)throw Error('The object and background could not be separated. Drag a rectangle around the object instead.');const seeds=new Uint8Array(w*h);seeds[seed]=1;
  const connected=keepSeeded(Uint8Array.from(trimap,t=>t===1||t===3?1:0),seeds,w,h),clean=cleanSegment(connected,w,h,.1,0),low=fillModelHoles(clean,pixels,w,h,models.fg,models.bg);if(!low.some(Boolean))throw Error('No object was found at this point.');return finishSegment(image,low,scaled,models.fg,models.bg);
}
