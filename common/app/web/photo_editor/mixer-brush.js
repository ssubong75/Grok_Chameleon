export const PICKUP_RATE=.25;
const clamp01=v=>Math.max(0,Math.min(1,v));
function dabWeight(dx,dy,radius,hardness){const dist=Math.hypot(dx,dy);if(dist>radius)return 0;const solid=radius*clamp01(hardness);if(dist<=solid||radius<=solid)return 1;return (radius-dist)/Math.max(1e-6,radius-solid);}
function over(dst,i,src,k){const sa=src[3]*k,da=dst[i+3],oa=sa+da*(1-sa);if(oa>0)for(let c=0;c<3;c++)dst[i+c]=(src[c]*sa+dst[i+c]*da*(1-sa))/oa;dst[i+3]=oa;}
export function applyMixerStroke(image,points,settings,state,sample=null){
  const wet0=clamp01(settings.wet),mix0=clamp01(settings.mix),flow=clamp01(settings.flow),load=clamp01(settings.load);
  const radius=Math.max(.5,settings.size/2),spacing=Math.max(.5,settings.size*Math.max(.01,settings.spacing||.25));
  const width=image.width,height=image.height,data=image.data,sampled=sample?.data||null;
  let amount=state.reservoir?clamp01(state.amount):0,pickup=state.pickup?state.pickup.slice():null,carry=state.carry||0;
  const stamp=(x,y,pressure)=>{
    const wet=wet0*clamp01(pressure??1),mix=mix0*clamp01(pressure??1);
    const x0=Math.max(0,Math.floor(x-radius)),y0=Math.max(0,Math.floor(y-radius)),x1=Math.min(width,Math.ceil(x+radius)),y1=Math.min(height,Math.ceil(y+radius));
    const acc=[0,0,0];let wsum=0,asum=0;
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const w=dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1);if(w<=0)continue;const i=(py*width+px)*4,src=sampled||data,al=src[i+3]/255;for(let c=0;c<3;c++)acc[c]+=src[i+c]/255*w*al;wsum+=w;asum+=w*al;}
    if(asum>1e-6&&wet>0){const ca=asum/Math.max(1e-6,wsum),canvas=[acc[0]/asum,acc[1]/asum,acc[2]/asum,1];pickup=pickup?pickup.map((p,c)=>p+(canvas[c]-p)*PICKUP_RATE*wet*ca):canvas;}
    const wr=state.reservoir?amount*(1-mix*wet):0,wp=pickup?mix*wet:0,total=wr+wp;
    if(total>1e-6){const paint=[0,0,0,0];for(let c=0;c<4;c++)paint[c]=((state.reservoir?state.reservoir[c]:0)*wr+(pickup?pickup[c]:0)*wp)/total;const dep=Math.min(total,1)*flow;for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const k=dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1)*dep;if(k<=0)continue;const i=(py*width+px)*4,pixel=[data[i]/255,data[i+1]/255,data[i+2]/255,data[i+3]/255];over(pixel,0,paint,k);data[i]=Math.round(Math.max(0,Math.min(1,pixel[0]))*255);data[i+1]=Math.round(Math.max(0,Math.min(1,pixel[1]))*255);data[i+2]=Math.round(Math.max(0,Math.min(1,pixel[2]))*255);data[i+3]=Math.round(Math.max(0,Math.min(1,pixel[3]))*255);}}
    amount*=1-.08*(1-load);
  };
  if(!points.length)return state;
  let prev=points[0];stamp(prev.x,prev.y,prev.pressure);
  for(let i=1;i<points.length;i++){const next=points[i],dx=next.x-prev.x,dy=next.y-prev.y,length=Math.hypot(dx,dy);let traveled=spacing-carry;while(traveled<=length){const t=length?traveled/length:1;stamp(prev.x+dx*t,prev.y+dy*t,prev.pressure+(next.pressure-prev.pressure)*(t||0));traveled+=spacing;}carry=length-(traveled-spacing);prev=next;}
  state.amount=amount;state.pickup=pickup;state.carry=carry;return state;
}
export function installMixerOptions({state}){
  const bar=document.createElement('span');bar.id='mixer-option';bar.hidden=true;
  const field=(key,label,value)=>{const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.value=String(value);input.setAttribute('aria-label',label);input.onchange=()=>{state.mixerSettings[key]=Math.max(0,Math.min(100,Number(input.value)||0));input.value=String(state.mixerSettings[key]);};bar.append(label+' ',input,' ');return input;};
  state.mixerSettings=state.mixerSettings||{wet:50,load:50,mix:50,flow:100,sampleAll:false};
  field('wet','Wet',50);field('load','Load',50);field('mix','Mix',50);field('flow','Flow',100);
  const sample=document.createElement('input');sample.type='checkbox';sample.setAttribute('aria-label','Sample All Layers');sample.onchange=()=>{state.mixerSettings.sampleAll=sample.checked;};bar.append(sample,' Sample All Layers');
  document.getElementById('options').append(bar);return bar;
}
