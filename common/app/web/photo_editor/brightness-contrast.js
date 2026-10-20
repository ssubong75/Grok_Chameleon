const clamp=v=>Math.max(0,Math.min(1,v));
export function brightnessContrastSettings(s={}){
  const brightness=Number(s.brightness??0),contrast=Number(s.contrast??0),legacy=Boolean(s.legacy);
  if(![brightness,contrast].every(Number.isFinite)||Math.abs(brightness)>150||contrast<(legacy?-100:-50)||contrast>100)throw Error('Invalid Brightness/Contrast settings.');
  return{brightness,contrast,legacy};
}
function raisedCurve(brightness){
  const s=1.375**(Math.abs(brightness)/50),e=1/(1+.084*Math.abs(brightness)),y0=126/255,x0=Math.min(1,y0/s),h=Math.max(1e-6,1-x0),secant=(1-y0)/h,alpha=s/secant,beta=e/secant;
  return x=>{if(x<=x0)return Math.min(y0,s*x);const t=clamp((x-x0)/h),t2=t*t,t3=t2*t;return clamp(alpha*alpha+beta*beta<=9?(2*t3-3*t2+1)*y0+(t3-2*t2+t)*h*s+(-2*t3+3*t2)+(t3-t2)*h*e:1-(1-y0)*(1-t)**alpha);};
}
function contrastCurve(v,c){if(!c)return v;const k=c/128,end=1-k,mid=1+k,half=t=>end*.5*(t*t*t-2*t*t+t)+(-2*t*t*t+3*t*t)*.5+mid*.5*(t*t*t-t*t);return v<=.5?half(v*2):1-half((1-v)*2);}
export function brightnessContrastPixels(image,settings){
  const {brightness:b,contrast:c,legacy}=brightnessContrastSettings(settings),table=new Float64Array(4096);
  if(legacy){const cc=Math.max(-100,Math.min(99,c)),k=cc>=0?1/(1-cc/100):1+cc/100,pre=cc>=0?b/255:0,post=cc>=0?0:b/255;for(let i=0;i<table.length;i++)table[i]=clamp((i/4095+pre-128/255)*k+128/255+post);}
  else{
    const raised=raisedCurve(b);let fine=null,j=0;if(b<0){fine=Float64Array.from({length:16384},(_,i)=>raised(i/16383));}
    for(let i=0;i<table.length;i++){let v=i/4095;if(b>0)v=raised(v);else if(b<0){while(j+2<fine.length&&fine[j+1]<v)j++;const f=fine[j+1]>fine[j]?clamp((v-fine[j])/(fine[j+1]-fine[j])):0;v=clamp((j+f)/16383);}table[i]=clamp(contrastCurve(v,c));}
  }
  const pixels=image.data;for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++){const x=pixels[i+c]/255*4095,k=Math.floor(x),f=x-k;pixels[i+c]=255*(table[k]*(1-f)+table[Math.min(4095,k+1)]*f);}return image;
}
