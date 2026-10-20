// PhotoCraft doc/adjust.rs HueRange and compose/adjust.rs hue_saturation/range tables.
const clamp=v=>Math.max(0,Math.min(1,v)),mod=(v,n)=>(v%n+n)%n;
export const hueRanges=['reds','yellows','greens','cyans','blues','magentas'];
function number(v,min,max){const n=Number(v??0);if(!Number.isFinite(n)||n<min||n>max)throw Error('Invalid Hue/Saturation value.');return n;}
export function canonicalHueBounds(bounds){
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite))throw Error('A hue range needs four finite bounds.');
  const out=[bounds[0]];for(let i=1;i<4;i++)out.push(Math.min(out[i-1]+mod(bounds[i]-out[i-1],360),out[0]+359));
  const centre=(out[1]+out[2])/2,shift=mod(centre+30,360)-30-centre;return out.map(v=>v+shift);
}
export function hueSaturationSettings(amount={}){
  let ranges=amount.ranges;if(typeof ranges==='string')ranges=JSON.parse(ranges||'[]');if(ranges==null)ranges=[];
  if(!Array.isArray(ranges)||ranges.length>6)throw Error('Hue/Saturation supports six color ranges.');
  return{hue:number(amount.hue,amount.colorize?0:-180,amount.colorize?360:180),saturation:number(amount.saturation,-100,100),lightness:number(amount.lightness,-100,100),colorize:Boolean(amount.colorize),ranges:hueRanges.map((_,i)=>{const r=ranges[i]||{};return{hue:number(r.hue,-180,180),saturation:number(r.saturation,-100,100),lightness:number(r.lightness,-100,100),bounds:canonicalHueBounds(r.bounds||[60*i-45,60*i-15,60*i+15,60*i+45])};})};
}
function weight(bounds,hue){const a=bounds[0],b=mod(bounds[1]-a,360),c=Math.max(b,mod(bounds[2]-a,360)),d=Math.max(c,mod(bounds[3]-a,360)),h=mod(hue-a,360);return h<=b?b<=0?1:h/b:h<=c?1:h<=d?d<=c?1:(d-h)/(d-c):0;}
function hsl(c){const mx=Math.max(...c),mn=Math.min(...c),l=(mx+mn)/2,d=mx-mn;if(Math.abs(d)<1e-7)return[0,0,l];const s=l>.5?d/(2-mx-mn):d/(mx+mn),h=mx===c[0]?mod((c[1]-c[2])/d,6):mx===c[1]?(c[2]-c[0])/d+2:(c[0]-c[1])/d+4;return[h/6,s,l];}
function rgb(h,s,l){if(s<=0)return[l,l,l];const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q,f=t=>{t=mod(t,1);return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return[f(h+1/3),f(h),f(h-1/3)];}
export function hueSaturationPixels(image,amount){
  const settings=hueSaturationSettings(amount),active=settings.colorize?[]:settings.ranges.filter(r=>r.hue||r.saturation||r.lightness),tables=active.length?Array.from({length:3},()=>new Float64Array(4096)):null;
  if(tables)for(let i=0;i<4096;i++)for(const range of active){const w=weight(range.bounds,i/4095*360);tables[0][i]+=w*range.hue;tables[1][i]+=w*range.saturation/100;tables[2][i]+=w*range.lightness/100;}
  const pixels=image.data;
  for(let i=0;i<pixels.length;i+=4){const original=[pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255];let dh=0,ds=0,dl=0;
    if(tables){const p=hsl(original)[0]*4095,j=Math.floor(p),f=p-j;[dh,ds,dl]=tables.map(t=>t[j]*(1-f)+t[Math.min(4095,j+1)]*f);}
    const light=settings.lightness/100,lighten=v=>light>0?v+(1-v)*light:v*(1+light);let out;
    if(settings.colorize)out=rgb(mod(settings.hue,360)/360,Math.min(1,Math.abs(settings.saturation/100)),lighten(hsl(original)[2]));
    else{const [h,s,l]=hsl(original.map(lighten)),sat=Math.max(-1,Math.min(1,settings.saturation/100+ds)),ss=clamp(sat>0?s/Math.max(1/512,1-sat):s*(1+sat));out=rgb(mod(h+(settings.hue+dh)/360,1),ss,l);}
    dl=Math.max(-1,Math.min(1,dl));const target=dl>0?Math.max(...out):Math.min(...out);for(let c=0;c<3;c++)pixels[i+c]=(out[c]+(target-out[c])*Math.abs(dl))*255;
  }return image;
}
