import {compositeTextGamma} from './text-gamma.js';
import {effectHex,effectInkHex,inkInMode} from './device-paint.js';
import {customBlends,compositeCustom} from './blend-modes.js';
import {renderFill} from './fill-renderer.js';
import {alphaMap,satinMap,bevelMaps,shadowMap,glowMap,narrowStrokeMap,wideStrokeMap} from './surface-effects.js';
function canvas(width,height){const result=document.createElement('canvas');result.width=width;result.height=height;return result;}
const opacity=(value,fallback)=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):fallback;
function silhouette(source,width,height,x,y,color='#ffffff',solid=false){const result=canvas(width,height),ctx=result.getContext('2d');if(solid){ctx.fillStyle=color;ctx.fillRect(x,y,source.width,source.height);return result;}ctx.drawImage(source,x,y);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return result;}
function paintEffect(ctx,image,settings){if(settings.blend==='dissolve')settings={...settings,blend:'source-over'};if(customBlends.has(settings.blend)){compositeCustom(ctx.canvas,image,settings.blend,opacity(settings.opacity,1));return;}ctx.save();ctx.globalAlpha=opacity(settings.opacity,1);ctx.globalCompositeOperation=settings.blend||'source-over';ctx.drawImage(image,0,0);ctx.restore();}
function innerEffect(base,settings,glow=false,origin=null){return glow?glowMap(alphaMap(base),base.width,base.height,settings,true,origin):shadowMap(alphaMap(base),base.width,base.height,settings,true,origin);}
let effectDocument=null;
export function useEffectDocument(doc){effectDocument=doc||null;}
function withGlobalLight(effect){if(!effect?.useGlobalLight||!effectDocument?.globalLight)return effect;return {...effect,angle:effectDocument.globalLight.angle,altitude:effectDocument.globalLight.altitude};}
function paintColor(color){return effectDocument?effectHex(effectDocument,color):color;}
function paintStops(stops,inks){if(typeof stops!=='string')return stops;let index=0;return stops.replace(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g,color=>{const ink=inks?.[index++],fromInk=ink&&ink.mode===effectDocument?.colorMode&&String(ink.hex||'').toLowerCase()===color.toLowerCase()?effectInkHex(effectDocument,ink):null;return fromInk||paintColor(color);});}
function paintEffectRecord(effect){if(!effect||!effectDocument||effectDocument.colorMode==='rgb')return effect;const next={...effect};for(const key of ['color','highlightColor','shadowColor','colorA','colorB']){const ink=effect[key+'Ink'],hex=typeof next[key]==='string'?next[key]:'';const fromInk=ink&&ink.mode===effectDocument.colorMode&&String(ink.hex||'').toLowerCase()===hex.toLowerCase()?effectInkHex(effectDocument,ink):null;if(fromInk)next[key]=fromInk;else if(typeof next[key]==='string')next[key]=paintColor(next[key]);}if(typeof next.stops==='string')next.stops=paintStops(next.stops,effect.stopsInk);return next;}
export function stampEffectInk(effects,ink,doc){const chosen=hex=>{const color=String(hex||'').toLowerCase();if(ink?.mode&&Array.isArray(ink.values)&&color===String(ink.hex||'').toLowerCase())return {mode:ink.mode,values:ink.values.slice(),hex:color};return ink?null:inkInMode(doc,color);};const visit=node=>{if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key==='stops'&&typeof value==='string'){const parts=[...value.matchAll(/#[0-9a-fA-F]{6}/g)].map(match=>match[0].toLowerCase());node.stopsInk=parts.map(hex=>chosen(hex));if(node.stopsInk.every(item=>!item))node.stopsInk=null;}else if(typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)&&/color/i.test(key)){const next=chosen(value);if(next)node[key+'Ink']=next;else delete node[key+'Ink'];}else if(value&&typeof value==='object'&&!Array.isArray(value))visit(value);}};visit(effects);return effects;}
export function renderEffects(source,effects,fillOpacity=1,transparencyShapes=true,blendInterior=false,shapeSource=source,layerBlend='source-over',origin={x:0,y:0},vectorStroke=null,backdrop=null,textGamma=1){
  if(effectDocument&&effects)effects=Object.fromEntries(Object.entries(effects).map(([key,effect])=>[key,paintEffectRecord(effect)]));
  fillOpacity=opacity(fillOpacity,1);
  if(!effects||effects.enabled===false||!Object.values(effects).some(effect=>effect?.enabled)){if(fillOpacity===1)return{canvas:source,offsetX:0,offsetY:0};const output=canvas(source.width,source.height),ctx=output.getContext('2d');ctx.globalAlpha=fillOpacity;ctx.drawImage(source,0,0);return{canvas:output,offsetX:0,offsetY:0};}
  const shadow=withGlobalLight(effects.shadow)||{},stroke=effects.stroke||{},overlay=effects.overlay||{};
  const blur=Math.max(0,Math.min(250,Number(shadow.blur)||0)),distance=Math.max(0,Math.min(500,Number(shadow.distance)||0)),size=Math.max(1,Math.min(50,Math.round(stroke.size)||1));
  const inner=withGlobalLight(effects.innerShadow)||{},outer=effects.outerGlow||{},innerGlow=effects.innerGlow||{};
  const bevel=withGlobalLight(effects.bevel)||{},satin=withGlobalLight(effects.satin)||{};
  const padding=Math.ceil(Math.max(shadow.enabled?blur*3+distance:0,stroke.enabled?size:0,outer.enabled?Math.max(0,Math.min(250,Number(outer.blur)||0))*3:0,inner.enabled?Math.max(0,Math.min(250,Number(inner.blur)||0))*3+Math.max(0,Math.min(500,Number(inner.distance)||0)):0,innerGlow.enabled?Math.max(0,Math.min(250,Number(innerGlow.blur)||0))*3:0,bevel.enabled?Math.min(250,Number(bevel.size)||5)+Math.min(100,Number(bevel.soften)||0)+2:0,satin.enabled?Math.min(250,Number(satin.distance)||0)+Math.min(250,Number(satin.size)||0):0))+2;
  const width=source.width+padding*2,height=source.height+padding*2;
  if(width>32767||height>32767||width*height>64000000)throw Error('Layer effects exceed the image size limit.');
  const exterior=[],post=[],output=canvas(width,height),ctx=output.getContext('2d'),effectOrigin={x:Math.round(origin.x||0)-padding,y:Math.round(origin.y||0)-padding};
  const solid=transparencyShapes===false,base=silhouette(shapeSource,width,height,padding,padding,'#ffffff',solid);
  const alpha=bevel.enabled||satin.enabled?alphaMap(base):null,bevelLayers=bevel.enabled?bevelMaps(alpha,width,height,bevel,effectOrigin,{x:origin.x+(Number(bevel.texture?.anchorOffset?.x)||0),y:origin.y+(Number(bevel.texture?.anchorOffset?.y)||0)}):null;
  const knockExterior=(image,amount)=>{if(amount<=0)return;const paint=image.getContext('2d'),pixels=paint.getImageData(0,0,width,height),shape=base.getContext('2d').getImageData(0,0,width,height).data;for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=Math.round(pixels.data[i]*(1-shape[i]/255*amount));paint.putImageData(pixels,0,0);};
  if(shadow.enabled){
    const image=shadowMap(alphaMap(base),width,height,shadow,false,effectOrigin);
    if(shadow.knocksOut!==false)knockExterior(image,['source-over','dissolve','pass-through'].includes(layerBlend)?1-fillOpacity:1);const settings={...shadow,blend:shadow.blend||'multiply',opacity:opacity(shadow.opacity,.75)};exterior.push({image,settings});paintEffect(ctx,image,settings);
  }
  if(outer.enabled){const glow=glowMap(alphaMap(base),width,height,outer,false,effectOrigin);knockExterior(glow,1-fillOpacity);exterior.push({image:glow,settings:outer});paintEffect(ctx,glow,outer);}
  let outsideStroke=null;
  if(stroke.enabled&&size<20)outsideStroke=narrowStrokeMap(alphaMap(base),width,height,size,stroke.color||'#000000');
  else if(stroke.enabled)outsideStroke=wideStrokeMap(alphaMap(base),width,height,size,stroke.color||'#000000');
  if(bevelLayers){for(const [image,settings]of [[bevelLayers.outerHi,{opacity:Number(bevel.highlight??75)/100,blend:'screen'}],[bevelLayers.outerShadow,{opacity:Number(bevel.shadow??75)/100,blend:'multiply'}]]){if(!['emboss','pillow'].includes(bevel.style))paintEffect(ctx,image,settings);if(bevel.style==='outer')exterior.push({image,settings,order:1});else if(['emboss','pillow'].includes(bevel.style))post.push({image,settings});}}
  const interiorGroup=blendInterior&&fillOpacity<1,sheet=canvas(width,height),ink=sheet.getContext('2d'),coverage=base.getContext('2d').getImageData(0,0,width,height).data;
  ink.drawImage(source,padding,padding);const content=ink.getImageData(0,0,width,height);for(let i=3;i<content.data.length;i+=4)content.data[i]=coverage[i]?Math.min(255,content.data[i]*255/coverage[i])*(interiorGroup?1:fillOpacity):0;ink.putImageData(content,0,0);
  const premerged=Boolean(backdrop&&!blendInterior&&!['source-over','dissolve','pass-through'].includes(layerBlend));
  if(premerged){const work=canvas(width,height),paint=work.getContext('2d');paint.drawImage(backdrop,padding-(origin.x||0),padding-(origin.y||0));for(const item of exterior)if(!item.order)paintEffect(paint,item.image,item.settings);if(textGamma!==1)compositeTextGamma(work,sheet,layerBlend,1,textGamma);else paintEffect(paint,sheet,{blend:layerBlend,opacity:1});ink.globalCompositeOperation='copy';ink.drawImage(work,0,0);ink.globalCompositeOperation='source-over';}
  const paintInterior=(image,settings)=>{const relative=canvas(width,height),paint=relative.getContext('2d'),pixels=image.getContext('2d').getImageData(0,0,width,height);for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=coverage[i]?Math.min(255,pixels.data[i]*255/coverage[i]):0;paint.putImageData(pixels,0,0);paintEffect(ink,relative,settings);};
  for(const [key,type]of [['patternOverlay','pattern'],['gradientOverlay','gradient']]){const settings=effects[key];if(!settings?.enabled)continue;const fill=renderFill({...settings,type,width:source.width,height:source.height}),layer=canvas(width,height),paint=layer.getContext('2d');paint.drawImage(fill,padding,padding);paint.globalCompositeOperation='destination-in';paint.drawImage(base,0,0);paintInterior(layer,settings);}
  if(overlay.enabled)paintInterior(silhouette(shapeSource,width,height,padding,padding,overlay.color||'#ff0000',solid),{opacity:opacity(overlay.opacity,1),blend:'source-over'});
  if(satin.enabled)paintInterior(satinMap(alpha,width,height,satin),satin);
  if(innerGlow.enabled)paintInterior(innerEffect(base,innerGlow,true,effectOrigin),innerGlow);
  if(interiorGroup){const image=ink.getImageData(0,0,width,height);for(let i=3;i<image.data.length;i+=4)image.data[i]=Math.round(image.data[i]*fillOpacity);ink.putImageData(image,0,0);}
  if(inner.enabled)paintInterior(innerEffect(base,inner,false,effectOrigin),inner);
  if(vectorStroke){const strokeLayer=canvas(width,height),paint=strokeLayer.getContext('2d');paint.drawImage(vectorStroke,padding,padding);const pixels=paint.getImageData(0,0,width,height);for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=coverage[i]?Math.min(255,pixels.data[i]*255/coverage[i])*fillOpacity:0;paint.putImageData(pixels,0,0);ink.drawImage(strokeLayer,0,0);}
  if(bevelLayers&&!['emboss','pillow'].includes(bevel.style)){paintInterior(bevelLayers.hi,{opacity:Number(bevel.highlight??75)/100,blend:'screen'});paintInterior(bevelLayers.shadow,{opacity:Number(bevel.shadow??75)/100,blend:'multiply'});}
  const inside=ink.getImageData(0,0,width,height);for(let i=3;i<inside.data.length;i+=4)inside.data[i]=Math.round(inside.data[i]*coverage[i]/255);ink.putImageData(inside,0,0);
  if(outsideStroke){const paint=outsideStroke.getContext('2d'),pixels=paint.getImageData(0,0,width,height);for(let i=3;i<pixels.data.length;i+=4){const a=coverage[i]/255,c=inside.data[i]/255,share=c>=1?1:Math.max(0,Math.min(1,(1-a)/(1-c)));pixels.data[i]=Math.round(pixels.data[i]*share);}paint.putImageData(pixels,0,0);exterior.push({image:outsideStroke,settings:{blend:'source-over',opacity:1}});ctx.drawImage(outsideStroke,0,0);}
  ctx.drawImage(sheet,0,0);
  if(bevelLayers&&['emboss','pillow'].includes(bevel.style))post.push({image:bevelLayers.hi,settings:{opacity:Number(bevel.highlight??75)/100,blend:'screen'}},{image:bevelLayers.shadow,settings:{opacity:Number(bevel.shadow??75)/100,blend:'multiply'}});
  for(const item of post)paintEffect(ctx,item.image,item.settings);exterior.sort((a,b)=>(a.order||0)-(b.order||0));
  return{canvas:output,offsetX:-padding,offsetY:-padding,stages:{exterior,interior:sheet,interiorBlend:premerged||layerBlend==='dissolve'?'source-over':layerBlend,premerged,textGamma,post}};
}
