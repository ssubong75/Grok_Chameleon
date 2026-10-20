// PhotoCraft segment/focus.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {bilinear} from './photo-math.js';
import {boxMean} from './matting-math.js';
import {guidedColor} from './refine-selection.js';
import {cleanSegment} from './segment-model.js';
import {scaledSegmentImage} from './segment-image.js';
const clamp=v=>Math.max(0,Math.min(1,v));
export function selectFocus(image,settings={}){
  if(image.width<4||image.height<4)throw Error('Focus Area requires an image at least 4 × 4 pixels.');const range=Number(settings.range??.5),noise=Number(settings.noise??0);if(!Number.isFinite(range)||!Number.isFinite(noise))throw Error('Enter valid Focus Area values.');
  const scaled=scaledSegmentImage(image,1000000),{pixels,width:w,height:h,step}=scaled,lum=Float32Array.from(pixels,p=>.299*p[0]+.587*p[1]+.114*p[2]),lap=new Float32Array(w*h),at=(x,y)=>lum[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=at(x,y);lap[y*w+x]=Math.abs(2*c-at(x-1,y)-at(x+1,y))+Math.abs(2*c-at(x,y-1)-at(x,y+1));}
  const energy=boxMean(lap,w,h,Math.max(3,Math.floor(Math.min(w,h)/60))),sorted=new Float32Array(energy).sort(),p99=Math.max(1e-6,sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.99))]),floor=clamp(noise)*.5,threshold=.05+.9*(1-clamp(range))**2,binary=energy.map(v=>Math.max(0,Math.min(1,v/p99)-floor)/Math.max(.001,1-floor)>=threshold?1:0),data=new Float32Array(w*h*4);
  for(let i=0;i<pixels.length;i++){for(let c=0;c<3;c++)data[i*4+c]=pixels[i][c]*255;data[i*4+3]=255;}
  const smooth=guidedColor({width:w,height:h,data},binary,Math.max(2,Math.floor(Math.min(w,h)/50)),.01),mask=cleanSegment(Uint8Array.from(smooth,v=>v>=.5?1:0),w,h,.05,.02);if(!mask.some(Boolean))throw Error('No in-focus area was found. Increase the In-Focus Range.');
  const field=Float32Array.from(smooth,(v,i)=>mask[i]?Math.max(.5,Math.min(1,v)):Math.max(0,Math.min(.5,v))),out=new Uint8ClampedArray(image.width*image.height);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)out[y*image.width+x]=Math.round(255*clamp((bilinear(field,w,h,(x+.5)/step-.5,(y+.5)/step-.5)-.5)*3+.5));return out;
}
