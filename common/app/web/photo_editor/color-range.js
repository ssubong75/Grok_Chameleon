// PhotoCraft selection.rs and color/convert.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
const clamp=v=>Math.max(0,Math.min(1,v));
function lab8(rgb){
  const [r,g,b]=rgb.map(v=>{v=clamp(v);return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}),f=t=>t>(6/29)**3?Math.cbrt(t):t/(3*(6/29)**2)+4/29,x=f((.436074*r+.385064*g+.143080*b)/.96422),y=f(.222504*r+.716878*g+.060618*b),z=f((.013932*r+.097104*g+.714173*b)/.82521);
  return[Math.round((116*y-16)*2.55)/2.55,Math.round(500*(x-y)),Math.round(200*(y-z))];
}
function reshape(range,value,fuzziness){
  for(let k=0;k<3;k++){
    const m=value[k],lo=range.lo[k],hi=range.hi[k];if(m>lo&&m<hi){if(m-lo<hi-m)range.lo[k]=m;else range.hi[k]=m;continue;}
    const width=k===0?fuzziness/2.55:fuzziness*256/255/3,q=width/5;if(q<=0)continue;const d=m<=lo?lo-m:m-hi,n=Math.floor(d/q)+1;if(n>5)continue;if(m<=lo)range.lo[k]=Math.min(hi,m+n*q);else range.hi[k]=Math.max(lo,m-n*q);
  }
}
function coverage(lab,range,fuzz){
  const outside=(v,lo,hi)=>Math.max(0,lo-v,v-hi);
  if(fuzz<=0)return Math.max(outside(lab[0],range.lo[0],range.hi[0])*2.55,outside(lab[1],range.lo[1],range.hi[1]),outside(lab[2],range.lo[2],range.hi[2]))<.5?1:0;
  const ab=(v,lo,hi)=>v>hi?v-hi+.5:v<lo?Math.max(0,lo-v-.5):0,t=Math.max(outside(lab[0],range.lo[0],range.hi[0])*2.55,3*ab(lab[1],range.lo[1],range.hi[1]),3*ab(lab[2],range.lo[2],range.hi[2]))/(fuzz*256/255),v=t<=.5?1-2*t*t:t<1?2*(1-t)**2:0;return Math.max(0,Math.min(255,Math.floor(v*256)))/255;
}
const hueCenters={reds:0,yellows:60,greens:120,cyans:180,blues:240,magentas:300};
export function colorRange(image,settings={}){
  const {width:w,height:h,data}=image,preset=settings.preset||'sampled',fuzz=Number(settings.fuzziness??40),samples=settings.samples||[],radius=Number(settings.localizedRadius)||0;
  if(data.length!==w*h*4||!Number.isFinite(fuzz)||fuzz<0||fuzz>200)throw Error('Choose fuzziness from 0 to 200.');
  let range=null;const positions=[];
  for(const sample of samples){
    if(!Array.isArray(sample.color)||sample.color.length!==3||!sample.color.every(Number.isFinite))throw Error('Invalid Color Range sample.');const lab=lab8(sample.color);
    if(sample.subtract){if(range)reshape(range,lab,fuzz);}
    else{if(!range)range={lo:[...lab],hi:[...lab]};else for(let k=0;k<3;k++){range.lo[k]=Math.min(range.lo[k],lab[k]);range.hi[k]=Math.max(range.hi[k],lab[k]);}if(Number.isFinite(sample.x)&&Number.isFinite(sample.y))positions.push([sample.x,sample.y]);}
  }
  if(preset==='sampled'&&!range)throw Error('Pick a color in the preview first.');
  const out=new Uint8ClampedArray(w*h),lo=Number(settings.toneLow??75),hi=Number(settings.toneHigh??190);
  if(!['sampled','skin','shadows','midtones','highlights',...Object.keys(hueCenters)].includes(preset))throw Error('Unknown Color Range preset.');
  for(let i=0;i<out.length;i++){
    const offset=i*4;if(!data[offset+3]){out[i]=settings.invert?255:0;continue;}const r=data[offset]/255,g=data[offset+1]/255,b=data[offset+2]/255,y=.299*r+.587*g+.114*b;let value=0;
    if(preset==='sampled'){
      value=coverage(lab8([r,g,b]),range,fuzz);if(radius>0&&positions.length&&value){let near=0;for(const [sx,sy]of positions)near=Math.max(near,clamp(1-Math.hypot(i%w-sx,Math.floor(i/w)-sy)/Math.max(1,radius)));value*=near;}
    }else if(preset in hueCenters){
      const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let hue=delta<=0?0:max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4;hue=((hue*60)%360+360)%360;const d=((hue-hueCenters[preset])%360+360)%360;value=clamp(1-Math.min(d,360-d)/60)*delta*(2-max);
    }else if(preset==='skin'){
      const rr=r*255,gg=g*255,bb=b*255,cb=128-.168736*rr-.331264*gg+.5*bb-104,cr=128+.5*rr-.418688*gg-.081312*bb-158,angle=-40*Math.PI/180,sin=Math.sin(angle),cos=Math.cos(angle),d=Math.hypot((cos*cb+sin*cr)/22,(cos*cr-sin*cb)/14);value=clamp(1-(d-1)/Math.max(.001,fuzz/100))*clamp((y*255-25)/30)*clamp((250-y*255)/20);
    }else{
      const lower=preset==='shadows'?0:preset==='highlights'?hi:lo,upper=preset==='highlights'?255:preset==='shadows'?lo:hi,level=y*255,d=level<lower?lower-level:level>upper?level-upper:0;value=clamp(1-d/Math.max(.001,Math.min(100,fuzz)*255/100));
    }
    out[i]=Math.round(255*(settings.invert?1-clamp(value):clamp(value)));
  }
  return out;
}
