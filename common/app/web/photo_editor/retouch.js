// Dodge/Burn/Sponge transfer curves adapted from PhotoCraft algo/retouch.rs.
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const luma=c=>c[0]*.299+c[1]*.587+c[2]*.114;
function gamut(c,l){l=clamp(l);const low=Math.min(...c),high=Math.max(...c);let t=1;if(high>1&&high-l>1e-9)t=Math.min(t,(1-l)/(high-l));if(low<0&&l-low>1e-9)t=Math.min(t,l/(l-low));return c.map(value=>l+(value-l)*t);}
function tone(v,e,range,burn){v=Math.max(0,v);const bounded=Math.min(1,v);if(range==='shadows')return burn?v-e*(1-bounded)**2*v:v+e*(1-bounded)**3;if(range==='highlights')return burn?v-e*bounded**2*v:v+e*bounded**2*(1-bounded);const weight=clamp(4*v*(1-v));return v+weight*(bounded**(burn?1+e:1/(1+e))-v);}
export function toneColor(c,strength,range,burn,protect){if(!protect)return c.map(value=>tone(value,strength,range,burn));const old=luma(c),next=tone(old,strength,range,burn);return gamut(old>1e-6?c.map(value=>value*next/old):[next,next,next],next);}
export function spongeColor(c,strength,saturate,vibrance){const high=Math.max(...c),low=Math.min(...c),s=high<=1e-6?0:clamp((high-low)/high);let a=clamp(strength);if(vibrance)a*=saturate?1-s:.25+.75*s;const l=luma(c),k=saturate?1+a:1-a;return gamut(c.map(value=>l+(value-l)*k),l);}
export function retouchStroke(canvas,from,to,options){
  const ctx=canvas.getContext('2d'),radius=Math.max(.5,options.width/2),margin=radius+2,left=Math.max(0,Math.floor(Math.min(from.x,to.x)-margin)),top=Math.max(0,Math.floor(Math.min(from.y,to.y)-margin)),right=Math.min(canvas.width,Math.ceil(Math.max(from.x,to.x)+margin)),bottom=Math.min(canvas.height,Math.ceil(Math.max(from.y,to.y)+margin));if(right<=left||bottom<=top)return;
  const dx=to.x-from.x,dy=to.y-from.y,span=dx*dx+dy*dy,extra=Math.ceil(Math.max(3,Math.abs(dx),Math.abs(dy))),readLeft=Math.max(0,left-extra),readTop=Math.max(0,top-extra),readRight=Math.min(canvas.width,right+extra),readBottom=Math.min(canvas.height,bottom+extra),source=ctx.getImageData(readLeft,readTop,readRight-readLeft,readBottom-readTop),output=ctx.getImageData(left,top,right-left,bottom-top);
  const get=(x,y,c)=>{x=clamp(Math.round(x),readLeft,readRight-1);y=clamp(Math.round(y),readTop,readBottom-1);return source.data[((y-readTop)*source.width+x-readLeft)*4+c]/255;};
  const clip=document.createElement('canvas');clip.width=right-left;clip.height=bottom-top;const paint=clip.getContext('2d');paint.translate(-left,-top);options.clip?.(paint);paint.fillStyle='#fff';paint.fillRect(left,top,clip.width,clip.height);const coverage=paint.getImageData(0,0,clip.width,clip.height).data;
  const strength=clamp(options.strength),hardness=clamp(options.hardness),opacity=clamp(options.opacity),kernel=[.004433,.054006,.242036,.39905,.242036,.054006,.004433];
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const t=span?clamp(((x+.5-from.x)*dx+(y+.5-from.y)*dy)/span):0,distance=Math.hypot(x+.5-from.x-t*dx,y+.5-from.y-t*dy);if(distance>radius)continue;
    const i=((y-top)*output.width+x-left)*4,falloff=hardness>=.999?1:clamp((radius-distance)/Math.max(.001,radius*(1-hardness))),weight=falloff*opacity*coverage[i+3]/255;if(!weight)continue;const original=[get(x,y,0),get(x,y,1),get(x,y,2)];let next=original;
    if(options.tool==='dodge'||options.tool==='burn')next=toneColor(original,strength,options.range,options.tool==='burn',options.protect);
    else if(options.tool==='sponge')next=spongeColor(original,strength,options.saturate,options.vibrance);
    else if(options.tool==='smudge')next=[0,1,2].map(c=>original[c]+(get(x-dx,y-dy,c)-original[c])*strength);
    else if(options.tool==='blurBrush'||options.tool==='sharpenBrush'){
      const sums=[0,0,0];let alpha=0;for(let ky=-3;ky<=3;ky++)for(let kx=-3;kx<=3;kx++){const w=kernel[kx+3]*kernel[ky+3],a=get(x+kx,y+ky,3)*w;alpha+=a;for(let c=0;c<3;c++)sums[c]+=get(x+kx,y+ky,c)*a;}
      const blurred=sums.map(value=>alpha?value/alpha:0);next=original.map((value,c)=>options.tool==='blurBrush'?value+(blurred[c]-value)*strength:value+(value-blurred[c])*strength*2);
    }
    for(let c=0;c<3;c++)output.data[i+c]=(original[c]*(1-weight)+next[c]*weight)*255;
  }ctx.putImageData(output,left,top);
}
