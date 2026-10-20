// PhotoCraft segment/subject.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {fitColorModel,subsample,cleanSegment,fillModelHoles,keepSeeded} from './segment-model.js';
import {scaledSegmentImage,finishSegment} from './segment-image.js';
import {grabCut} from './segment-object.js';
import {subjectSaliency,otsu} from './segment-saliency.js';
function backdropPass(pixels,w,h,blob){
  let x0=w,y0=h,x1=-1,y1=-1;for(let i=0;i<blob.length;i++)if(blob[i]){const x=i%w,y=Math.floor(i/w);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}if(x1<x0)return null;
  const margin=Math.max(4,Math.ceil(Math.max(x1-x0+1,y1-y0+1)*.15)),bx0=Math.max(0,x0-margin),by0=Math.max(0,y0-margin),bx1=Math.min(w-1,x1+margin),by1=Math.min(h-1,y1+margin),frame=Math.max(2,Math.round(Math.min(w,h)*.06)),inFrame=(x,y)=>x<frame||y<frame||x+frame>=w||y+frame>=h,near=(x,y)=>x>=bx0&&x<=bx1&&y>=by0&&y<=by1,samples=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inFrame(x,y)&&!near(x,y))samples.push(pixels[y*w+x]);const backdrop=fitColorModel(subsample(samples,40000),5,2e-5);if(!backdrop)return null;
  const costs=samples.map(p=>backdrop.negativeLog(p)).sort((a,b)=>a-b),limit=costs[Math.floor(costs.length*.99)]+4,trimap=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;trimap[i]=inFrame(x,y)&&!near(x,y)?0:blob[i]||backdrop.negativeLog(pixels[i])>limit?3:2;}
  const models=grabCut(pixels,w,h,trimap,4);if(!models)return null;const low=keepSeeded(Uint8Array.from(trimap,v=>v===1||v===3?1:0),blob,w,h);return low.some(Boolean)?{...models,low}:null;
}
export function selectSubject(image){
  if(image.width<4||image.height<4||image.data.length!==image.width*image.height*4)throw Error('Subject selection requires an image at least 4 × 4 pixels.');
  const scaled=scaledSegmentImage(image,110000),{pixels,width:w,height:h}=scaled,saliency=subjectSaliency(pixels,w,h),threshold=Math.max(.15,Math.min(.85,otsu(saliency))),trimap=new Uint8Array(w*h);let any=false;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,border=!x||!y||x+1===w||y+1===h;if(saliency[i]>=threshold){trimap[i]=3;any=true;}else trimap[i]=border||saliency[i]<.4*threshold?0:2;}
  if(!any)throw Error('No distinct subject was found. Try Object Selection around the subject.');
  let models=grabCut(pixels,w,h,trimap,6);if(!models)throw Error('The subject and background could not be separated. Try Object Selection.');
  let low=cleanSegment(Uint8Array.from(trimap,v=>v===1||v===3?1:0),w,h,.2,0);if(!low.some(Boolean))throw Error('No distinct subject was found. Try Object Selection.');
  const backdrop=backdropPass(pixels,w,h,low);if(backdrop){models=backdrop;low=backdrop.low;}
  low=fillModelHoles(low,pixels,w,h,models.fg,models.bg,.002,.05);return finishSegment(image,low,scaled,models.fg,models.bg);
}
