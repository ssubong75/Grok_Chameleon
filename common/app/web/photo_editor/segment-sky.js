// PhotoCraft segment/sky.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {bilinear} from './photo-math.js';
import {boxMean,guided} from './matting-math.js';
import {cleanSegment,fitColorModel,subsample} from './segment-model.js';
const clamp=v=>Math.max(0,Math.min(1,v)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);},luma=p=>.299*p[0]+.587*p[1]+.114*p[2];
function prior(p){
  const [r,g,b]=p,y=luma(p),max=Math.max(r,g,b),sat=max>1e-4?(max-Math.min(r,g,b))/max:0;
  const blue=smooth(.02,.12,b-r)*smooth(-.12,0,b-g)*smooth(.18,.4,y),white=smooth(.5,.75,y)*(1-smooth(.12,.3,sat)),warm=.6*smooth(.55,.8,y)*smooth(0,.1,r-b)*(1-smooth(.05,.25,g-b-.2));return Math.max(blue,white,warm);
}
function likelihood(pixels,w,h){
  const lum=Float32Array.from(pixels,luma),grad=new Float32Array(w*h),at=(x,y)=>lum[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const gx=at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1)-at(x-1,y-1)-2*at(x-1,y)-at(x-1,y+1),gy=at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1)-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1);grad[y*w+x]=Math.hypot(gx,gy)/8;
  }
  const texture=boxMean(grad,w,h,2);return Float32Array.from(pixels,(p,i)=>prior(p)*(1-smooth(.015,.07,texture[i])));
}
function lowMask(pixels,w,h,threshold){
  if(w<2||h<2)return null;const like=likelihood(pixels,w,h),t=.12+.6*clamp(threshold/100),rows=Math.max(1,Math.floor(h/40)),mask=new Uint8Array(w*h),stack=new Uint32Array(w*h);let count=0;
  for(let i=0;i<rows*w;i++)if(like[i]>t){mask[i]=1;stack[count++]=i;}if(count*20<rows*w)return null;
  while(count){const i=stack[--count],x=i%w,y=Math.floor(i/w);for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1]){
    if(j<0||mask[j]||like[j]<=t)continue;const a=pixels[i],b=pixels[j];if(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.12){mask[j]=1;stack[count++]=j;}
  }}
  const samples=pixels.filter((_,i)=>mask[i]);if(samples.length>=16){const model=fitColorModel(subsample(samples,4000));if(model){const values=subsample(samples,2000).map(p=>model.negativeLog(p)).sort((a,b)=>a-b),cut=values[Math.min(values.length-1,Math.floor(values.length*.95))];for(let i=0;i<mask.length;i++)if(!mask[i]&&like[i]>t+.1&&model.negativeLog(pixels[i])<=cut)mask[i]=1;}}
  const clean=cleanSegment(mask,w,h);let covered=0,saturation=0,selected=0;
  for(let i=(h-rows)*w;i<h*w;i++)covered+=clean[i];for(let i=0;i<clean.length;i++)if(clean[i]){const p=pixels[i],max=Math.max(...p);saturation+=max>1e-4?(max-Math.min(...p))/max:0;selected++;}
  if(!selected||covered*10>=rows*w*6&&saturation/selected<.1)return null;return clean;
}
const rgb=(data,i)=>{const a=data[i+3]/255;return[data[i]/255*a+.5*(1-a),data[i+1]/255*a+.5*(1-a),data[i+2]/255*a+.5*(1-a)];};
export function selectSky(image,settings={}){
  const {width:w,height:h,data}=image;if(w<4||h<4||data.length!==w*h*4)throw Error('Sky selection requires an image at least 4 × 4 pixels.');
  const threshold=Number(settings.threshold??50),softness=Number(settings.softness??50);if(!Number.isFinite(threshold)||!Number.isFinite(softness))throw Error('Invalid sky selection settings.');
  const step=Math.max(1,Math.ceil(Math.sqrt(w*h/160000))),lw=Math.ceil(w/step),lh=Math.ceil(h/step),pixels=new Array(lw*lh);
  for(let oy=0;oy<lh;oy++)for(let ox=0;ox<lw;ox++){const sum=[0,0,0];let n=0;for(let y=oy*step;y<Math.min(h,(oy+1)*step);y++)for(let x=ox*step;x<Math.min(w,(ox+1)*step);x++){const p=rgb(data,(y*w+x)*4);for(let c=0;c<3;c++)sum[c]+=p[c];n++;}pixels[oy*lw+ox]=sum.map(v=>v/n);}
  const mask=lowMask(pixels,lw,lh,threshold);if(!mask)throw Error('No sky was found at the top edge. Try a lower threshold or select the sky manually.');
  const coarse=Float32Array.from(mask),soft=clamp(softness/100),radius=Math.max(3,Math.ceil(step*(1+2*soft))),epsilon=1e-4+4e-3*soft,ramp=.08+.42*soft,output=new Uint8ClampedArray(w*h),halo=2*radius;
  for(let ty=0;ty<h;ty+=256)for(let tx=0;tx<w;tx+=256){
    const tw=Math.min(256,w-tx),th=Math.min(256,h-ty),left=Math.max(0,tx-halo),top=Math.max(0,ty-halo),right=Math.min(w,tx+tw+halo),bottom=Math.min(h,ty+th+halo),ww=right-left,hh=bottom-top,pm=new Float32Array(ww*hh);let lo=Infinity,hi=-Infinity;
    for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){const value=bilinear(coarse,lw,lh,(left+x+.5)/step-.5,(top+y+.5)/step-.5);pm[y*ww+x]=value;lo=Math.min(lo,value);hi=Math.max(hi,value);}
    if(hi<=0||lo>=1){for(let y=ty;y<ty+th;y++)output.fill(lo>=1?255:0,y*w+tx,y*w+tx+tw);continue;}
    const guide=new Float32Array(ww*hh);for(let y=0;y<hh;y++)for(let x=0;x<ww;x++)guide[y*ww+x]=luma(rgb(data,((top+y)*w+left+x)*4));const q=guided(guide,pm,ww,hh,radius,epsilon);
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++)output[(ty+y)*w+tx+x]=Math.round(255*smooth(.5-ramp,.5+ramp,q[(ty+y-top)*ww+tx+x-left]));
  }
  return output;
}
