import {featherCoverage} from './selection-feather.js';
import {distanceCoverage} from './selection-distance.js';
import {morphMask,squareExtreme} from './mask-math.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function integerMorph(input,w,h,r,grow,shape,extend){
  const output=shape==='square'?squareExtreme(input,w,h,r,grow):morphMask(input,w,h,r,grow);
  if(!grow&&!extend&&r)for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.min(x+1,y+1,w-x,h-y)<=r)output[y*w+x]=0;
  return output;
}
function morph(input,w,h,r,grow,shape,extend){
  const whole=Math.floor(r),fraction=r-whole,lo=integerMorph(input,w,h,whole,grow,shape,extend);if(fraction<1e-6)return lo;const hi=integerMorph(input,w,h,whole+1,grow,shape,extend);for(let i=0;i<lo.length;i++)lo[i]+=(hi[i]-lo[i])*fraction;return lo;
}
export function modifyCoverage(input,w,h,operation,settings={}){
  if(input.length!==w*h)throw Error('Selection dimensions changed.');
  const amount=Number(settings.amount??settings.radius);if(!Number.isFinite(amount)||amount<.1||amount>1000)throw Error('Choose an amount from 0.1 to 1000 pixels.');
  const values=Float32Array.from(input),extend=operation!=='border'&&settings.canvasBounds!==true,shape=settings.shape==='square'?'square':'rounded';let output;
  if(operation==='feather')output=featherCoverage(values,w,h,amount,extend);
  else if(shape==='rounded'&&['expand','contract','border'].includes(operation))output=distanceCoverage(values,w,h,amount,operation,!extend,settings.placement||'center');
  else if(operation==='expand'||operation==='contract')output=morph(values,w,h,amount,operation==='expand',shape,extend);
  else if(operation==='border'){
    const placement=settings.placement||'center',outside=placement==='inside'?values:morph(values,w,h,placement==='center'?amount/2:amount,true,shape,extend),inside=placement==='outside'?values:morph(values,w,h,placement==='center'?amount/2:amount,false,shape,extend);
    output=outside;for(let i=0;i<output.length;i++)output[i]=Math.max(0,outside[i]-inside[i]);
  }else throw Error('Unknown selection modification.');
  return Uint8ClampedArray.from(output,value=>clamp(value,0,255));
}
