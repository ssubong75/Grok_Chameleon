import {t} from './i18n.js';
export function formatReadoutLength(px,unit='pixels',dpi=72,extent=1,pointSize='postScript'){
 const resolution=Number.isFinite(dpi)&&dpi>0?dpi:72;
 const ppi=pointSize==='traditional'?72.27:72;
 const units={pixels:[1,0,'px'],inches:[resolution,3,'in'],centimeters:[resolution/2.54,2,'cm'],millimeters:[resolution/25.4,2,'mm'],points:[resolution/ppi,1,'pt'],picas:[resolution*12/ppi,2,'pica'],percent:[Math.max(1,extent)/100,1,'%']};
 const [divisor,decimals,suffix]=units[unit]||units.pixels;return `${Number((Math.abs(px)/divisor).toFixed(decimals))} ${suffix}`;
}
export function marqueeReadout(gesture,enabled,options={}){
  if(!enabled||!gesture||!['marquee','ellipse','singleRowMarquee','singleColumnMarquee'].includes(gesture.tool))return null;
  const rect=gesture.rect,at=gesture.last||gesture.start;if(!rect||!at||![rect.w,rect.h,at.x,at.y].every(Number.isFinite))return null;
  return{at,lines:[`W: ${formatReadoutLength(rect.w,options.unit,options.dpi,options.width,options.pointSize)}`,`H: ${formatReadoutLength(rect.h,options.unit,options.dpi,options.height,options.pointSize)}`]};
}
export function drawMarqueeReadout(context,gesture,enabled,zoom,options={}){
  const readout=marqueeReadout(gesture,enabled,options);if(!readout)return;
  drawValueCard(context,readout.at,['W:','H:'],readout.lines.map(line=>line.slice(3)),zoom);
}
export function drawValueCard(context,at,labels,values,zoom){
  labels=labels.map(label=>t(label));
  const scale=1/Math.max(.01,zoom),style=typeof document==='undefined'?null:getComputedStyle(document.documentElement),token=(key,fallback)=>style?.getPropertyValue('--theme-'+key).trim()||fallback;context.save();context.font=`${11.5*scale}px sans-serif`;context.setLineDash([]);
  const labelWidth=Math.max(...labels.map(text=>context.measureText(text).width)),valueWidth=Math.max(...values.map(text=>context.measureText(text).width));
  const width=labelWidth+valueWidth+26*scale,x=at.x+16*scale,y=at.y+18*scale;
  context.fillStyle=token('card','#282828');context.strokeStyle=token('card-border','#555');context.lineWidth=scale;context.beginPath();if(context.roundRect)context.roundRect(x,y,width,(8+14.5*labels.length)*scale,3*scale);else context.rect(x,y,width,(8+14.5*labels.length)*scale);context.fill();context.stroke();context.textBaseline='top';
  labels.forEach((label,index)=>{const rowY=y+(4+14.5*index)*scale;context.textAlign='left';context.fillStyle=token('text-dim','#ccc');context.fillText(label,x+7*scale,rowY);context.textAlign='right';context.fillStyle=token('text','#fff');context.fillText(values[index],x+width-7*scale,rowY);});context.restore();
}
export function fixedReadout(value,places){const k=10**places,rounded=Math.sign(value)*Math.round(Math.abs(value)*k)/k;return (rounded===0?0:rounded).toFixed(places);}
export function transformReadoutValues(transform){
 const target=transform?.free||transform,drag=target?.drag;
 if(target?.kind==='transform'&&drag?.quad){
  if(drag.handle==='inside'){const dx=target.quad[0][0]-drag.quad[0][0],dy=target.quad[0][1]-drag.quad[0][1];return {labels:['ΔX:','ΔY:'],values:[`${fixedReadout(dx,0)} px`,`${fixedReadout(dy,0)} px`]};}
  if(drag.handle==='outside'||target.mode==='rotate'&&(drag.handle==='corner'||drag.handle==='edge')){const a0=Math.atan2(drag.quad[1][1]-drag.quad[0][1],drag.quad[1][0]-drag.quad[0][0]),a1=Math.atan2(target.quad[1][1]-target.quad[0][1],target.quad[1][0]-target.quad[0][0]);return {labels:['Angle:'],values:[`${fixedReadout((a1-a0)*180/Math.PI,1)}°`]};}
  if(drag.handle==='corner'||drag.handle==='edge'){const baseW=Math.hypot(target.base[1][0]-target.base[0][0],target.base[1][1]-target.base[0][1])||1,baseH=Math.hypot(target.base[3][0]-target.base[0][0],target.base[3][1]-target.base[0][1])||1,w=Math.hypot(target.quad[1][0]-target.quad[0][0],target.quad[1][1]-target.quad[0][1])/baseW*100,h=Math.hypot(target.quad[3][0]-target.quad[0][0],target.quad[3][1]-target.quad[0][1])/baseH*100;return {labels:['W:','H:'],values:[`${fixedReadout(w,1)}%`,`${fixedReadout(h,1)}%`]};}
 }
 if(target?.kind==='transform'&&drag&&target.pointer&&(drag.handle==='point'||drag.handle==='pull'))return {labels:['ΔX:','ΔY:'],values:[`${fixedReadout(target.pointer.x-drag.start.x,0)} px`,`${fixedReadout(target.pointer.y-drag.start.y,0)} px`]};
 const settings=target?.settings;if(!drag||!settings)return null;
 if(![settings.x,settings.y,settings.angle,settings.scaleX,settings.scaleY].every(Number.isFinite))return null;
 if(drag.handle==='rotate')return{labels:['Angle:'],values:[`${fixedReadout(settings.angle,1)}°`]};
 if(drag.handle==='move')return{labels:['ΔX:','ΔY:'],values:[`${fixedReadout(settings.x-drag.settings.x,0)} px`,`${fixedReadout(settings.y-drag.settings.y,0)} px`]};
 if(['nw','ne','sw','se','n','s','e','w'].includes(drag.handle))return{labels:['W:','H:'],values:[`${fixedReadout(settings.scaleX*100,1)}%`,`${fixedReadout(settings.scaleY*100,1)}%`]};
 return null;
}
export function drawTransformReadout(context,transform,gesture,enabled,zoom){
 const at=gesture?.last||gesture?.start;if(!enabled||gesture?.tool!=='freeTransform'||!at)return;const readout=transformReadoutValues(transform);if(readout)drawValueCard(context,at,readout.labels,readout.values,zoom);
}
