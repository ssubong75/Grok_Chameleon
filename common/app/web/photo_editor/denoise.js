// PhotoCraft denoise.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {clamp,gaussian,guided} from './photo-math.js';
const unit=value=>clamp(Number(value)||0,0,100)/100;
export function reduceNoise(image,settings={}){
  const {width:w,height:h,data}=image,n=w*h;if(!n)return image;
  const strength=clamp(Number(settings.strength)||0,0,10),s=strength/10,preserve=unit(settings.preserve),color=unit(settings.color),sharpen=unit(settings.sharpen),jpeg=Boolean(settings.jpeg);
  if(!s&&!color&&!sharpen&&!jpeg)return image;
  const y=new Float32Array(n),cb=new Float32Array(n),cr=new Float32Array(n);
  for(let i=0;i<n;i++){const at=i*4,r=data[at]/255,g=data[at+1]/255,b=data[at+2]/255,l=.299*r+.587*g+.114*b;y[i]=l;cb[i]=b-l;cr[i]=r-l;}
  if(jpeg){const original=new Float32Array(y);for(let yy=1;yy+1<h;yy++)for(let xx=1;xx+1<w;xx++)if(xx%8===0||xx%8===7||yy%8===0||yy%8===7){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=original[(yy+dy)*w+xx+dx];const i=yy*w+xx;y[i]=.5*original[i]+sum/18;}}
  if(s){const radius=Math.min(5,Math.max(1,Math.round(1+strength*.4))),eps=(.004+.05*s)**2*(1.05-preserve),smooth=guided(y,y,w,h,radius,eps),mix=Math.sqrt(s);for(let i=0;i<n;i++)y[i]+=(smooth[i]-y[i])*mix;}
  if(color){const radius=Math.min(9,Math.max(1,Math.round(1+color*8))),eps=(.01+.05*color)**2;for(const plane of [cb,cr]){const smooth=guided(y,plane,w,h,radius,eps);for(let i=0;i<n;i++)plane[i]+=(smooth[i]-plane[i])*color;}}
  if(sharpen){const blur=gaussian(y,w,h,1);for(let i=0;i<n;i++)y[i]+=(y[i]-blur[i])*sharpen*1.2;}
  for(let i=0;i<n;i++){const at=i*4,l=y[i],r=cr[i]+l,b=cb[i]+l;data[at]=clamp(r)*255;data[at+1]=clamp((l-.299*r-.114*b)/.587)*255;data[at+2]=clamp(b)*255;}
  return image;
}
