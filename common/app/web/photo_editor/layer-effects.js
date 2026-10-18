import {renderFill} from './fill-renderer.js';
import {alphaMap,satinMap,bevelMaps} from './surface-effects.js';
function canvas(width,height){const result=document.createElement('canvas');result.width=width;result.height=height;return result;}
const opacity=(value,fallback)=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):fallback;
function silhouette(source,width,height,x,y,color='#ffffff'){const result=canvas(width,height),ctx=result.getContext('2d');ctx.drawImage(source,x,y);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return result;}
function paintEffect(ctx,image,settings){ctx.save();ctx.globalAlpha=opacity(settings.opacity,1);ctx.globalCompositeOperation=settings.blend||'source-over';ctx.drawImage(image,0,0);ctx.restore();}
function innerEffect(base,settings,glow=false){const w=base.width,h=base.height,inverse=canvas(w,h),p=inverse.getContext('2d');p.fillStyle='#fff';p.fillRect(0,0,w,h);p.globalCompositeOperation='destination-out';p.drawImage(base,0,0);const shadow=canvas(w,h),s=shadow.getContext('2d'),angle=(Number(settings.angle)||0)*Math.PI/180,distance=glow?0:Math.max(0,Math.min(500,Number(settings.distance)||0));s.filter=`blur(${Math.max(0,Math.min(100,Number(settings.blur)||0))}px)`;s.drawImage(inverse,Math.cos(angle)*distance,Math.sin(angle)*distance);s.filter='none';s.globalCompositeOperation='source-in';s.fillStyle=settings.color||'#000000';s.fillRect(0,0,w,h);s.globalCompositeOperation='destination-in';s.drawImage(base,0,0);return shadow;}
export function renderEffects(source,effects,fillOpacity=1){
  fillOpacity=opacity(fillOpacity,1);
  if(!effects||!Object.values(effects).some(effect=>effect?.enabled)){if(fillOpacity===1)return{canvas:source,offsetX:0,offsetY:0};const output=canvas(source.width,source.height),ctx=output.getContext('2d');ctx.globalAlpha=fillOpacity;ctx.drawImage(source,0,0);return{canvas:output,offsetX:0,offsetY:0};}
  const shadow=effects.shadow||{},stroke=effects.stroke||{},overlay=effects.overlay||{};
  const blur=Math.max(0,Math.min(100,Number(shadow.blur)||0)),distance=Math.max(0,Math.min(500,Number(shadow.distance)||0)),size=Math.max(1,Math.min(50,Math.round(stroke.size)||1));
  const inner=effects.innerShadow||{},outer=effects.outerGlow||{},innerGlow=effects.innerGlow||{};
  const bevel=effects.bevel||{},satin=effects.satin||{};
  const padding=Math.ceil(Math.max(shadow.enabled?blur*3+distance:0,stroke.enabled?size:0,outer.enabled?Math.max(0,Math.min(100,Number(outer.blur)||0))*3:0,inner.enabled?Math.max(0,Math.min(100,Number(inner.blur)||0))*3+Math.max(0,Math.min(500,Number(inner.distance)||0)):0,innerGlow.enabled?Math.max(0,Math.min(100,Number(innerGlow.blur)||0))*3:0,bevel.enabled?Math.min(250,Number(bevel.size)||5)+Math.min(100,Number(bevel.soften)||0)+2:0,satin.enabled?Math.min(250,Number(satin.distance)||0)+Math.min(250,Number(satin.size)||0):0))+2;
  const width=source.width+padding*2,height=source.height+padding*2;
  if(width*height>64000000)throw Error('Layer effects exceed the image size limit.');
  const output=canvas(width,height),ctx=output.getContext('2d');
  const base=silhouette(source,width,height,padding,padding);
  const alpha=bevel.enabled||satin.enabled?alphaMap(base):null,bevelLayers=bevel.enabled?bevelMaps(alpha,width,height,bevel):null;
  if(outer.enabled){const glow=canvas(width,height),g=glow.getContext('2d');g.filter=`blur(${Math.max(0,Math.min(100,Number(outer.blur)||0))}px)`;g.drawImage(silhouette(source,width,height,padding,padding,outer.color||'#ffffbe'),0,0);g.filter='none';g.globalCompositeOperation='destination-out';g.drawImage(base,0,0);paintEffect(ctx,glow,outer);}
  if(shadow.enabled){
    const silhouette=canvas(width,height),paint=silhouette.getContext('2d');paint.drawImage(source,padding,padding);paint.globalCompositeOperation='source-in';paint.fillStyle=shadow.color||'#000000';paint.fillRect(0,0,width,height);
    const angle=(Number(shadow.angle)||0)*Math.PI/180;ctx.save();ctx.globalAlpha=opacity(shadow.opacity,.75);ctx.filter=`blur(${blur}px)`;ctx.drawImage(silhouette,Math.cos(angle)*distance,Math.sin(angle)*distance);ctx.restore();
  }
  if(stroke.enabled){
    const silhouette=canvas(width,height),paint=silhouette.getContext('2d');
    // Circular alpha dilation gives an outside outline, including transparent holes.
    const steps=Math.max(12,Math.ceil(size*Math.PI*2));for(let i=0;i<steps;i++){const angle=i/steps*Math.PI*2;paint.drawImage(source,padding+Math.cos(angle)*size,padding+Math.sin(angle)*size);}
    paint.globalCompositeOperation='source-in';paint.fillStyle=stroke.color||'#000000';paint.fillRect(0,0,width,height);ctx.drawImage(silhouette,0,0);
  }
  if(bevelLayers){paintEffect(ctx,bevelLayers.outerHi,{opacity:Number(bevel.highlight??75)/100,blend:'screen'});paintEffect(ctx,bevelLayers.outerShadow,{opacity:Number(bevel.shadow??75)/100,blend:'multiply'});}
  ctx.save();ctx.globalAlpha=fillOpacity;ctx.drawImage(source,padding,padding);ctx.restore();
  for(const [key,type]of [['patternOverlay','pattern'],['gradientOverlay','gradient']]){const settings=effects[key];if(!settings?.enabled)continue;const fill=renderFill({...settings,type,width:source.width,height:source.height}),layer=canvas(width,height),paint=layer.getContext('2d');paint.drawImage(fill,padding,padding);paint.globalCompositeOperation='destination-in';paint.drawImage(base,0,0);paintEffect(ctx,layer,settings);}
  if(overlay.enabled){const tinted=canvas(source.width,source.height),paint=tinted.getContext('2d');paint.drawImage(source,0,0);paint.globalCompositeOperation='source-in';paint.fillStyle=overlay.color||'#ff0000';paint.fillRect(0,0,tinted.width,tinted.height);ctx.save();ctx.globalAlpha=opacity(overlay.opacity,1);ctx.drawImage(tinted,padding,padding);ctx.restore();}
  if(satin.enabled)paintEffect(ctx,satinMap(alpha,width,height,satin),satin);
  if(innerGlow.enabled)paintEffect(ctx,innerEffect(base,innerGlow,true),innerGlow);
  if(inner.enabled)paintEffect(ctx,innerEffect(base,inner),inner);
  if(bevelLayers){paintEffect(ctx,bevelLayers.hi,{opacity:Number(bevel.highlight??75)/100,blend:'screen'});paintEffect(ctx,bevelLayers.shadow,{opacity:Number(bevel.shadow??75)/100,blend:'multiply'});}
  return{canvas:output,offsetX:-padding,offsetY:-padding};
}
