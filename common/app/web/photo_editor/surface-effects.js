import {patternTile,patternLuminance} from './pattern-tile.js';
import {bevelDistances} from './bevel-distance.js';
import {outsideEffectDistance} from './effect-distance.js';
import {effectContour,contourValue} from './effect-contour.js';
// Smooth bevel and satin maps adapted from PhotoCraft compose/effects.rs.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const roundAway=value=>value<0?-Math.round(-value):Math.round(value);
function boxLine(source,start,length,width){width=Math.max(1,width);const r=Math.max(0,Math.ceil(width/2-.5)),f=clamp(width/2-(r-.5),0,1),out=new Float32Array(length),at=i=>i>=0&&i<source.length?source[i]:0;if(!r){for(let i=0;i<length;i++)out[i]=at(start+i);return out;}let sum=0;for(let i=start-r+1;i<=start+r-1;i++)sum+=at(i);for(let i=0;i<length;i++){const x=start+i;out[i]=(sum+f*(at(x-r)+at(x+r)))/width;sum+=at(x+r)-at(x-r+1);}return out;}
function tentLine(source,width){const r=Math.max(0,Math.ceil(Math.max(1,width)/2-.5));return boxLine(boxLine(source,-r,source.length+2*r,width),r,source.length,width);}
export function tentMap(source,w,h,size){if(size<=1)return new Float32Array(source);const temp=new Float32Array(source.length),out=new Float32Array(source.length);for(let y=0;y<h;y++)temp.set(tentLine(source.subarray(y*w,(y+1)*w),size),y*w);for(let x=0;x<w;x++){const column=new Float32Array(h);for(let y=0;y<h;y++)column[y]=temp[y*w+x];const result=tentLine(column,size);for(let y=0;y<h;y++)out[y*w+x]=result[y];}return out;}
function bitmap(w,h,map,color){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h),rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));for(let i=0;i<map.length;i++){image.data[i*4]=rgb[0];image.data[i*4+1]=rgb[1];image.data[i*4+2]=rgb[2];image.data[i*4+3]=255*clamp(map[i],0,1);}ctx.putImageData(image,0,0);return canvas;}
export function alphaMap(canvas){const {data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),alpha=new Float32Array(canvas.width*canvas.height);for(let i=0;i<alpha.length;i++)alpha[i]=data[i*4+3]/255;return alpha;}
export function satinMap(shape,w,h,s){const angle=(Number(s.angle)||0)*Math.PI/180,d=Math.max(1,Number(s.distance)||1),dx=roundAway(-Math.cos(angle)*d),dy=roundAway(Math.sin(angle)*d),a=new Float32Array(shape.length),b=new Float32Array(shape.length),at=(x,y)=>x<0||y<0||x>=w||y>=h?0:shape[y*w+x];for(let y=0;y<h;y++)for(let x=0;x<w;x++){a[y*w+x]=at(x-dx,y-dy);b[y*w+x]=at(x+dx,y+dy);}const aa=tentMap(a,w,h,Math.max(1,Number(s.size)||1)),bb=tentMap(b,w,h,Math.max(1,Number(s.size)||1)),out=new Float32Array(shape.length),contour=effectContour(s.contour);for(let i=0;i<out.length;i++){const difference=Math.abs(aa[i]-bb[i]),value=contour?Math.abs(contourValue(contour,1-difference)-contour[4095]):difference;out[i]=(s.invert?1-value:value)*shape[i];}return bitmap(w,h,out,s.color||'#000000');}
export function bevelMaps(shape,w,h,b,origin={x:0,y:0},anchor={x:0,y:0}){const size=clamp(Number(b.size)||5,1,250),both=['emboss','pillow'].includes(b.style),width=both?Math.ceil(size/2):size;const technique=b.technique||'smooth',smooth=technique==='smooth',soft=technique==='chisel soft';let height;
  if(smooth)height=tentMap(shape,w,h,width);else{const {inside,outside}=bevelDistances(shape,w,h,size),ramp=size+1,top=(size+2)/ramp,half=size/2+.5;height=Float32Array.from(shape,(_,i)=>{const din=inside[i],dout=outside[i];if(b.style==='outer')return soft?(dout>0?1-clamp((dout+.5)/ramp,0,1):top):(dout>0?clamp((size+1.5-dout)/ramp,0,top):top);if(both)return din>0?.5+.5*clamp(din/half,0,1):.5-.5*clamp(dout/half,0,1);return din>0?clamp((din+(soft?1.5:.5))/ramp,0,soft?top:1):0;});if(soft&&both)height=tentMap(height,w,h,Math.max(size/4,1));}if(b.heightContour){const contour=effectContour(b.heightContour);if(contour)height=Float32Array.from(height,value=>contourValue(contour,value));}if(b.texture){const t=b.texture,tile=patternTile(t.tile);if(tile){const scale=Number(t.scale),inv=Number.isFinite(scale)&&scale>.001?1/scale:1,unit=Math.abs(Number(b.depth)||0)>1e-4?(smooth?width:size/2):Math.max(1,width),k=Number(t.depth)/Math.max(.001,unit),ox=(t.link!==false?anchor.x:0)+(Number(t.phase?.x)||0),oy=(t.link!==false?anchor.y:0)+(Number(t.phase?.y)||0);if(Number.isFinite(k))for(let y=0;y<h;y++)for(let x=0;x<w;x++){const l=patternLuminance(tile,(origin.x+x+.5-ox)*inv,(origin.y+y+.5-oy)*inv);height[y*w+x]+=k*(t.invert?1-l:l);}}}if(Number(b.soften)>=1)height=tentMap(height,w,h,Math.min(100,Number(b.soften)));const angle=(Number(b.angle)||0)*Math.PI/180,altitude=clamp(Number(b.altitude??30),0,90)*Math.PI/180,se=Math.sin(altitude),ce=Math.cos(altitude),lx=Math.cos(angle)*ce,ly=-Math.sin(angle)*ce,depth=clamp(Number(b.depth)||0,0,1000)/100*(smooth?width:size/2)*(b.up===false?-1:1),hi=new Float32Array(shape.length),shadow=new Float32Array(shape.length),outerHi=new Float32Array(shape.length),outerShadow=new Float32Array(shape.length),at=(x,y)=>x<0||y<0||x>=w||y>=h?0:height[y*w+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,gx=(at(x+1,y)-at(x-1,y))*.5,gy=(at(x,y+1)-at(x,y-1))*.5,on=height[i]>1e-5||((both||!smooth&&b.style==='outer')&&[at(x+1,y),at(x-1,y),at(x,y+1),at(x,y-1)].some(v=>v>1e-5));for(const outside of [false,true]){if(outside?(!both&&b.style!=='outer'):(b.style==='outer'))continue;const region=outside?(shape[i]<1-.5/255&&on?1:0):shape[i];if(!region)continue;const d=outside&&b.style==='pillow'?-depth:depth,nx=-gx*d,ny=-gy*d,k=(nx*lx+ny*ly+se)/Math.hypot(nx,ny,1)-se;const a=k>0?clamp(k/Math.max(.001,1-se),0,1)*region:0,z=k<0?clamp(-k/Math.max(.001,se),0,1)*region:0;if(outside){outerHi[i]=a;outerShadow[i]=z;}else{hi[i]=a;shadow[i]=z;}}}
  const gloss=effectContour(b.contour);if(gloss)for(const map of both?[hi,shadow,outerHi,outerShadow]:b.style==='outer'?[outerHi,outerShadow]:[hi,shadow])for(let i=0;i<map.length;i++)map[i]=contourValue(gloss,map[i]);
  return{hi:bitmap(w,h,hi,b.highlightColor||'#ffffff'),shadow:bitmap(w,h,shadow,b.shadowColor||'#000000'),outerHi:bitmap(w,h,outerHi,b.highlightColor||'#ffffff'),outerShadow:bitmap(w,h,outerShadow,b.shadowColor||'#000000')};
}

// Source dist_outside_by(Chamfer) / dilate: subpixel seeds and two raster passes.
export function dilateEffect(shape,w,h,radius){
  if(radius<=0)return new Float32Array(shape);
  const distances=Float32Array.from(shape,a=>a>.5/255?1-Math.min(1,a):1e20),steps=[[-1,0,1],[-1,-1,Math.SQRT2],[0,-1,1],[1,-1,Math.SQRT2],[-1,-2,2.236068],[1,-2,2.236068],[-2,-1,2.236068],[2,-1,2.236068]];
  for(const sign of [1,-1])for(let row=0;row<h;row++){const y=sign===1?row:h-1-row;for(let column=0;column<w;column++){const x=sign===1?column:w-1-column,i=y*w+x;let best=distances[i];for(const [ox,oy,weight]of steps){const nx=x+ox*sign,ny=y+oy*sign;if(nx>=0&&ny>=0&&nx<w&&ny<h)best=Math.min(best,distances[ny*w+nx]+weight);}distances[i]=best;}}
  return Float32Array.from(shape,(a,i)=>a>.5/255?Math.min(1,a+radius):Math.max(a,clamp(radius+1-distances[i],0,1)));
}
function softenEffect(values,w,h,size,spread,outsideOne=false){
  const fraction=clamp(Number(spread)||0,0,100)/100,radius=Math.round(size*fraction),width=size*(1-fraction),grown=dilateEffect(values,w,h,radius);
  if(!outsideOne)return tentMap(grown,w,h,width);
  const blurred=tentMap(Float32Array.from(grown,a=>1-a),w,h,width);return Float32Array.from(blurred,a=>1-a);
}
function effectNoise(values,w,h,amount,origin){
  amount=clamp(Number(amount)||0,0,100)/100;if(!amount)return;
  const ox=Math.trunc(origin?.x||0),oy=Math.trunc(origin?.y||0);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(values[i]<=0)continue;let hash=Math.imul(ox+x,0x8da6b343)^Math.imul(oy+y,0xd8163841)^0x9e3779b9;hash^=hash>>>15;hash=Math.imul(hash,0x2c1b3c6d);hash^=hash>>>12;values[i]=clamp(values[i]+((hash&0xffff)/65536-.5)*2*amount,0,1);}
}
// Source shadow_map, linear contour subset. Inner maps extend as one.
export function shadowMap(shape,w,h,settings,inner=false,origin=null){
  const angle=(Number(settings.angle)||0)*Math.PI/180,distance=clamp(Number(settings.distance)||0,0,500),dx=roundAway(-Math.cos(angle)*distance),dy=roundAway(Math.sin(angle)*distance),size=clamp(Number(settings.blur)||0,0,250),shifted=new Float32Array(shape.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=x-dx,sy=y-dy,a=sx<0||sy<0||sx>=w||sy>=h?0:shape[sy*w+sx];shifted[y*w+x]=inner?1-a:a;}
  // Blur the complement for inner shadows so the infinite outside remains one.
  const values=softenEffect(shifted,w,h,size,settings.spread,inner);
  const contour=effectContour(settings.contour);if(contour)for(let i=0;i<values.length;i++)values[i]=contourValue(contour,values[i]);
  effectNoise(values,w,h,settings.noise,origin);
  if(inner)for(let i=0;i<values.length;i++)values[i]*=shape[i];
  return bitmap(w,h,values,settings.color||'#000000');
}

// Source softer glow_map, linear contour subset.
export function glowMap(shape,w,h,settings,inner=false,origin=null){
  const size=clamp(Number(settings.blur)||0,0,250),range=clamp(Number(settings.range??50)/100,.01,1),contour=effectContour(settings.contour),values=new Float32Array(shape.length);let blurred;
  if(settings.technique==='precise'){const distance=outsideEffectDistance(inner?Float32Array.from(shape,a=>a<=.5/255?1:0):shape,w,h),solid=size*clamp(Number(settings.spread)||0,0,100)/100,soft=Math.max(.001,size+1-solid);blurred=Float32Array.from(distance,value=>{const d=value+.5;return d<=solid?1:.5*clamp(1-(d-solid)/soft,0,1);});}
  else blurred=softenEffect(inner?Float32Array.from(shape,a=>1-a):shape,w,h,size,settings.spread,inner);
  for(let i=0;i<values.length;i++){let value=contourValue(contour,blurred[i]/range);if(inner&&settings.source==='center')value=1-value;values[i]=value;}
  effectNoise(values,w,h,settings.noise,origin);if(inner)for(let i=0;i<values.length;i++)values[i]*=shape[i];
  return bitmap(w,h,values,settings.color||'#ffffbe');
}

// Source narrow outside stroke band from the chamfer field (size>=1 makes inside solid).
export function narrowStrokeMap(shape,w,h,size,color){return bitmap(w,h,dilateEffect(shape,w,h,size),color);}

export function wideStrokeMap(shape,w,h,size,color){const distance=outsideEffectDistance(shape,w,h),band=Float32Array.from(distance,d=>clamp(size+.5-d,0,1));return bitmap(w,h,band,color);}
