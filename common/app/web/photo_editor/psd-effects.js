import {effectContour} from './effect-contour.js';
import {patternTile} from './pattern-tile.js';
import {parseStops} from './gradient-renderer.js';
const hex=color=>color&&['r','g','b'].every(c=>Number.isFinite(color[c]))&&(color.a==null||color.a===255)?'#'+['r','g','b'].map(c=>Math.round(Math.max(0,Math.min(255,color[c]))).toString(16).padStart(2,'0')).join(''):null;
const rgb=color=>/^#[\da-f]{6}$/i.test(color||'')?{r:parseInt(color.slice(1,3),16),g:parseInt(color.slice(3,5),16),b:parseInt(color.slice(5,7),16)}:null;
const choke=value=>value==null?0:typeof value==='number'?value:value?.value===0?0:value?.units==='Percent'?value.value/100:null;
const px=value=>({units:'Pixels',value:Number(value)||0});
const pixel=value=>value?.units==='Pixels'&&Number.isFinite(value.value)?value.value:null;
const blend=mode=>!mode||mode==='source-over'?'normal':mode.replaceAll('-',' ');
const fromBlend=mode=>mode==='normal'||!mode?'source-over':mode.replaceAll(' ','-');
const active=value=>Array.isArray(value)?value.filter(item=>item&&item.enabled!==false&&item.present!==false):value&&typeof value==='object'&&value.enabled!==false&&value.present!==false?[value]:[];
const unmapped=new Set();
function shadowRecord(effect,fallbackBlend){
  try{effectContour(effect.contour);}catch{return null;}
  const noise=Number(effect.noise??0)/100;if(!Number.isFinite(noise)||noise<0||noise>1)return null;
  const color=rgb(effect.color);if(!color)return null;
  const spread=Number(effect.spread??0);if(!Number.isFinite(spread)||spread<0||spread>100)return null;
  const opacity=Number(effect.opacity??.75);if(!Number.isFinite(opacity)||opacity<0||opacity>1)return null;
  return {enabled:true,present:true,showInDialog:true,blendMode:effect.blend?blend(effect.blend):fallbackBlend,color,opacity,angle:Number(effect.angle)||0,useGlobalLight:false,layerConceals:effect.knocksOut!==false,distance:px(effect.distance),size:px(effect.blur),contour:effect.contour||{name:'Linear',curve:[{x:0,y:0},{x:255,y:255}]},noise,choke:{units:'Percent',value:spread},antialiased:false};
}
function glowRecord(effect,fallbackBlend){
  try{effectContour(effect.contour);}catch{return null;}
  const noise=Number(effect.noise??0)/100;if(!Number.isFinite(noise)||noise<0||noise>1)return null;
  const range=Number(effect.range??50)/100;if(!Number.isFinite(range)||range<.01||range>1)return null;
  const color=rgb(effect.color);if(!color)return null;
  const spread=Number(effect.spread??0);if(!Number.isFinite(spread)||spread<0||spread>100)return null;
  const opacity=Number(effect.opacity??.75);if(!Number.isFinite(opacity)||opacity<0||opacity>1)return null;
  return {enabled:true,blendMode:effect.blend?blend(effect.blend):fallbackBlend,color,opacity,size:px(effect.blur),contour:effect.contour||{name:'Linear',curve:[{x:0,y:0},{x:255,y:255}]},noise,choke:{units:'Percent',value:spread},technique:effect.technique==='precise'?'precise':'softer',range,source:effect.source==='center'?'center':'edge'};
}
function shadowFields(effect,globalAngle){
  try{effectContour(effect.contour);}catch{return null;}
  const noise=(effect.noise??0)*100;if(!Number.isFinite(noise)||noise<0||noise>100)return null;
  const spread=choke(effect.choke);if(spread==null||!Number.isFinite(spread)||spread<0||spread>1)return null;
  const color=hex(effect.color),blur=pixel(effect.size),distance=pixel(effect.distance);if(!color||blur==null||distance==null||!Number.isFinite(effect.opacity))return null;
  return {enabled:true,color,opacity:effect.opacity,contour:effect.contour?structuredClone(effect.contour):null,noise,blur,spread:spread*100,distance,angle:effect.useGlobalLight!==false?globalAngle:Number(effect.angle??120),knocksOut:effect.layerConceals!==false,blend:fromBlend(effect.blendMode||'multiply')};
}
function glowFields(effect){
  try{effectContour(effect.contour);}catch{return null;}
  const noise=(effect.noise??0)*100;if(!Number.isFinite(noise)||noise<0||noise>100)return null;
  if(effect.technique&&!['softer','precise'].includes(effect.technique)||effect.gradient||effect.jitter)return null;
  const spread=choke(effect.choke);if(spread==null||!Number.isFinite(spread)||spread<0||spread>1)return null;
  const range=(effect.range??.5)*100;if(!Number.isFinite(range)||range<1||range>100)return null;
  const color=hex(effect.color),blur=pixel(effect.size);if(!color||blur==null||!Number.isFinite(effect.opacity))return null;
  return {enabled:true,color,opacity:effect.opacity,contour:effect.contour?structuredClone(effect.contour):null,noise,blur,spread:spread*100,range,technique:effect.technique==='precise'?'precise':'softer',source:effect.source==='center'?'center':'edge',blend:fromBlend(effect.blendMode||'screen')};
}
const linearContour=contour=>!contour||!contour.curve?.length||contour.curve.length===2&&contour.curve.every((p,i)=>p.x===i*255&&p.y===i*255);
function satinFields(effect){
  try{effectContour(effect.contour);}catch{return null;}
  const color=hex(effect.color),distance=pixel(effect.distance),size=pixel(effect.size),angle=Number(effect.angle??19),opacity=Number(effect.opacity??.5);
  if(!color||distance==null||distance<0||distance>250||size==null||size<1||size>250||!Number.isFinite(angle)||!Number.isFinite(opacity)||opacity<0||opacity>1||effect.antialiased)return null;
  return{enabled:true,color,distance,size,angle,opacity,blend:fromBlend(effect.blendMode||'multiply'),contour:effect.contour?structuredClone(effect.contour):null,invert:Boolean(effect.invert)};
}
function satinRecord(effect){
  try{effectContour(effect.contour);}catch{return null;}
  const color=rgb(effect.color),distance=Number(effect.distance??1),size=Number(effect.size??1),angle=Number(effect.angle??0),opacity=Number(effect.opacity??1);
  if(!color||![distance,size,angle,opacity].every(Number.isFinite)||distance<0||distance>250||size<1||size>250||opacity<0||opacity>1||effect.antialiased)return null;
  return{enabled:true,present:true,showInDialog:true,color,blendMode:blend(effect.blend),opacity,angle,distance:px(distance),size:px(size),invert:Boolean(effect.invert),antialiased:false,contour:effect.contour||{name:'Linear',curve:[{x:0,y:0},{x:255,y:255}]}};
}
const gradientStyles=new Set(['linear','radial','angle','reflected','diamond']);
function gradientFields(effect){
  const gradient=effect.gradient,style=effect.type||'linear',opacity=effect.opacity??1,scale=effect.scale??1,angle=effect.angle??90;
  if(!gradient||gradient.type!=='solid'||gradient.smoothness!==1||!gradientStyles.has(style)||effect.align===false||effect.dither||effect.interpolationMethod&&effect.interpolationMethod!=='classic'||effect.offset&&(effect.offset.x||effect.offset.y))return null;
  if(![opacity,scale,angle].every(Number.isFinite)||opacity<0||opacity>1||scale<=0||!Array.isArray(gradient.colorStops)||gradient.colorStops.length<2||!Array.isArray(gradient.opacityStops)||gradient.opacityStops.some(stop=>stop.opacity!==1))return null;
  const stops=[];for(const stop of gradient.colorStops){const color=hex(stop.color);if(!color||!Number.isFinite(stop.location)||stop.location<0||stop.location>1||stop.midpoint!=null&&stop.midpoint!==.5)return null;stops.push((stop.location*100)+':'+color);}
  return{enabled:true,style,opacity,angle,scale:scale*100,reverse:Boolean(effect.reverse),offsetX:0,offsetY:0,stops:stops.join(', '),blend:fromBlend(effect.blendMode)};
}
function gradientRecord(effect){
  const style=effect.style||'linear',opacity=Number(effect.opacity??1),scale=Number(effect.scale??100)/100,angle=Number(effect.angle??0);
  if(!gradientStyles.has(style)||![opacity,scale,angle].every(Number.isFinite)||opacity<0||opacity>1||scale<=0||Number(effect.offsetX||0)!==0||Number(effect.offsetY||0)!==0||effect.dither)return null;
  try{const stops=parseStops(effect.stops,effect.colorA||'#000000',effect.colorB||'#ffffff');if(stops.some(([,color])=>!rgb(color)))return null;
    return{enabled:true,present:true,showInDialog:true,blendMode:blend(effect.blend),opacity,angle,scale,type:style,reverse:Boolean(effect.reverse),align:true,offset:{x:0,y:0},dither:false,interpolationMethod:'classic',gradient:{type:'solid',name:'Custom',smoothness:1,colorStops:stops.map(([location,color])=>({location,color:rgb(color),midpoint:.5})),opacityStops:[{location:0,opacity:1,midpoint:.5},{location:1,opacity:1,midpoint:.5}]}};
  }catch{return null;}
}
const bevelStyles={inner:'inner bevel',outer:'outer bevel',emboss:'emboss',pillow:'pillow emboss',stroke:'stroke emboss'};
function bevelTexture(effect,patterns){
  if(!effect.useTexture)return null;
  const source=patterns.find(p=>p.id===effect.pattern?.id),tile=source&&patternTile({width:source.bounds?.w,height:source.bounds?.h,data:source.data,id:source.id,name:source.name}),scale=effect.scale??1,depth=effect.textureDepth??1,phase=effect.phase||{x:0,y:0};
  if(!tile||![scale,depth,phase.x,phase.y].every(Number.isFinite)||scale<=0)return null;
  return{tile:{...tile,data:Array.from(tile.data)},scale,depth,phase:{...phase},invert:Boolean(effect.textureInvert),link:effect.align!==false};
}
function bevelFields(effect,globalAngle,globalAltitude,patterns){
  try{effectContour(effect.contour);if(effect.useShape)effectContour(effect.shapeContour);}catch{return null;}
  const style=Object.keys(bevelStyles).find(key=>bevelStyles[key]===(effect.style||'inner bevel')),size=pixel(effect.size),soften=effect.soften==null?0:pixel(effect.soften),depth=(effect.strength??1)*100,highlight=(effect.highlightOpacity??.75)*100,shadow=(effect.shadowOpacity??.75)*100,highlightColor=hex(effect.highlightColor||{r:255,g:255,b:255}),shadowColor=hex(effect.shadowColor||{r:0,g:0,b:0}),angle=effect.useGlobalLight!==false?globalAngle:effect.angle??120,altitude=effect.useGlobalLight!==false?globalAltitude:effect.altitude??30;
  const texture=bevelTexture(effect,patterns);
  if(!style||effect.technique&&!['smooth','chisel hard','chisel soft'].includes(effect.technique)||effect.useShape&&(!effect.shapeContour||effect.antialiased)||effect.useTexture&&!texture||effect.antialiasGloss||effect.highlightBlendMode&&effect.highlightBlendMode!=='screen'||effect.shadowBlendMode&&effect.shadowBlendMode!=='multiply'||!highlightColor||!shadowColor||![size,soften,depth,highlight,shadow,angle,altitude].every(Number.isFinite)||size<1||size>250||soften<0||soften>100||depth<0||depth>1000||highlight<0||highlight>100||shadow<0||shadow>100||altitude<0||altitude>90)return null;
  return{enabled:true,style,texture,technique:effect.technique||'smooth',size,soften,depth,highlight,shadow,highlightColor,shadowColor,angle,altitude,contour:effect.contour?structuredClone(effect.contour):null,heightContour:effect.useShape?structuredClone(effect.shapeContour):null,heightRange:effect.range??.5,up:effect.direction!=='down'};
}
function bevelRecord(effect){
  try{effectContour(effect.contour);effectContour(effect.heightContour);}catch{return null;}
  const style=bevelStyles[effect.style||'inner'],size=Number(effect.size??5),soften=Number(effect.soften??0),depth=Number(effect.depth??0),highlight=Number(effect.highlight??75),shadow=Number(effect.shadow??75),angle=Number(effect.angle??0),altitude=Number(effect.altitude??30),highlightColor=rgb(effect.highlightColor||'#ffffff'),shadowColor=rgb(effect.shadowColor||'#000000');
  if(!style||effect.technique&&!['smooth','chisel hard','chisel soft'].includes(effect.technique)||!highlightColor||!shadowColor||![size,soften,depth,highlight,shadow,angle,altitude].every(Number.isFinite)||size<1||size>250||soften<0||soften>100||depth<0||depth>1000||highlight<0||highlight>100||shadow<0||shadow>100||altitude<0||altitude>90)return null;
  const texture=effect.texture,tile=texture&&patternTile(texture.tile);if(texture&&(!tile||typeof tile.id!=='string'||!tile.id.length||tile.id.length>255||Array.from(tile.id).some(c=>c.charCodeAt(0)>127)||![texture.scale,texture.depth,texture.phase?.x??0,texture.phase?.y??0].every(Number.isFinite)||texture.scale<=0))return null;
  return{enabled:true,present:true,showInDialog:true,style,technique:effect.technique||'smooth',direction:effect.up===false?'down':'up',size:px(size),soften:px(soften),strength:depth/100,angle,altitude,useGlobalLight:false,highlightColor,shadowColor,highlightBlendMode:'screen',shadowBlendMode:'multiply',highlightOpacity:highlight/100,shadowOpacity:shadow/100,contour:effect.contour||{name:'Linear',curve:[{x:0,y:0},{x:255,y:255}]},antialiasGloss:false,useShape:Boolean(effect.heightContour),...(effect.heightContour?{shapeContour:structuredClone(effect.heightContour),range:Number.isFinite(effect.heightRange)?effect.heightRange:.5,antialiased:false}:{}),useTexture:Boolean(texture),...(texture?{pattern:{id:tile.id,name:tile.name||'Pattern'},scale:texture.scale,textureDepth:texture.depth,textureInvert:Boolean(texture.invert),align:texture.link!==false,phase:{x:texture.phase?.x??0,y:texture.phase?.y??0}}:{})};
}
function patternFields(effect,patterns){
  if(effect.align===false||Number(effect.angle||0)!==0||effect.phase&&(effect.phase.x||effect.phase.y))return null;
  const source=patterns.find(pattern=>pattern.id===effect.pattern?.id),tile=source&&patternTile({width:source.bounds?.w,height:source.bounds?.h,data:source.data,id:source.id,name:source.name}),scale=effect.scale??1,opacity=effect.opacity??1;
  if(!tile||![scale,opacity].every(Number.isFinite)||scale<=0||opacity<0||opacity>1)return null;
  return{enabled:true,style:'custom',tile:{...tile,data:Array.from(tile.data)},scale:scale*100,angle:0,offsetX:0,offsetY:0,opacity,blend:fromBlend(effect.blendMode)};
}
function patternRecord(effect){
  const tile=effect.style==='custom'&&patternTile(effect.tile),scale=Number(effect.scale??100)/100,opacity=Number(effect.opacity??1);
  if(!tile||typeof tile.id!=='string'||!tile.id.length||tile.id.length>255||Array.from(tile.id).some(c=>c.charCodeAt(0)>127)||![scale,opacity].every(Number.isFinite)||scale<=0||opacity<0||opacity>1||Number(effect.angle||0)!==0||Number(effect.offsetX||0)!==0||Number(effect.offsetY||0)!==0)return null;
  return{enabled:true,present:true,showInDialog:true,pattern:{id:tile.id,name:tile.name||'Pattern'},scale,opacity,blendMode:blend(effect.blend),align:true,angle:0,phase:{x:0,y:0}};
}
export function exportPsdPatterns(effects){
  const tiles=[];const overlay=effects?.patternOverlay;if(overlay?.enabled&&patternRecord(overlay))tiles.push(patternTile(overlay.tile));
  const bevel=effects?.bevel;if(bevel?.enabled&&bevel.texture&&bevelRecord(bevel))tiles.push(patternTile(bevel.texture.tile));
  return Array.from(new Map(tiles.filter(Boolean).map(tile=>[tile.id,{id:tile.id,name:tile.name||'Pattern',x:tile.width,y:tile.height,bounds:{x:0,y:0,w:tile.width,h:tile.height},data:Uint8Array.from(tile.data)}])).values());
}
export function importPsdEffects(data,globalAngle=120,globalAltitude=30,patterns=[]){
  if(!Number.isFinite(globalAngle))globalAngle=120;if(!Number.isFinite(globalAltitude))globalAltitude=30;
  if(!data||data.disabled)return{effects:null,unsupported:false};
  for(const [key,value]of Object.entries(data))if(unmapped.has(key)&&active(value).length)return{effects:null,unsupported:true};
  const effects={};const patternsFx=active(data.patternOverlay);if(patternsFx.length){const fields=patternsFx.length===1?patternFields(patternsFx[0],patterns):null;if(!fields)return{effects:null,unsupported:true};effects.patternOverlay=fields;}const bevels=active(data.bevel);if(bevels.length){const fields=bevels.length===1?bevelFields(bevels[0],globalAngle,globalAltitude,patterns):null;if(!fields)return{effects:null,unsupported:true};effects.bevel=fields;}const gradients=active(data.gradientOverlay);if(gradients.length){const fields=gradients.length===1?gradientFields(gradients[0]):null;if(!fields)return{effects:null,unsupported:true};effects.gradientOverlay=fields;}const satins=active(data.satin);if(satins.length){const fields=satins.length===1?satinFields(satins[0]):null;if(!fields)return{effects:null,unsupported:true};effects.satin=fields;}
  const fill=active(data.solidFill)[0];
  if(fill){const color=hex(fill.color),opacity=fill.opacity??1;if(!color||fill.blendMode&&fill.blendMode!=='normal'||!Number.isFinite(opacity)||opacity<0||opacity>1||active(data.solidFill).length!==1)return{effects:null,unsupported:true};effects.overlay={enabled:true,color,opacity};}
  const shadow=active(data.dropShadow);
  if(shadow.length){if(shadow.length!==1)return{effects:null,unsupported:true};const fields=shadowFields(shadow[0],globalAngle);if(!fields)return{effects:null,unsupported:true};effects.shadow=fields;}
  const inner=active(data.innerShadow);
  if(inner.length){if(inner.length!==1)return{effects:null,unsupported:true};const fields=shadowFields(inner[0],globalAngle);if(!fields)return{effects:null,unsupported:true};effects.innerShadow=fields;}
  if(data.outerGlow&&data.outerGlow.enabled!==false){const fields=glowFields(data.outerGlow);if(!fields)return{effects:null,unsupported:true};effects.outerGlow=fields;}
  if(data.innerGlow&&data.innerGlow.enabled!==false){const fields=glowFields(data.innerGlow);if(!fields)return{effects:null,unsupported:true};effects.innerGlow=fields;}
  const stroke=active(data.stroke);
  if(stroke.length){if(stroke.length!==1||stroke[0].position&&stroke[0].position!=='outside'||stroke[0].fillType&&stroke[0].fillType!=='color')return{effects:null,unsupported:true};const color=hex(stroke[0].color),size=pixel(stroke[0].size);if(!color||size==null)return{effects:null,unsupported:true};effects.stroke={enabled:true,color,size};}
  return {effects:Object.keys(effects).length?effects:null,unsupported:false};
}
export function exportPsdEffects(effects){
  if(!effects)return {};
  for(const [key,value]of Object.entries(effects))if(unmapped.has(key)&&value?.enabled)return null;
  const out={disabled:false,scale:1};let any=false;
  if(effects.patternOverlay?.enabled){const pattern=patternRecord(effects.patternOverlay);if(!pattern)return null;out.patternOverlay=pattern;any=true;}
  if(effects.bevel?.enabled){const bevel=bevelRecord(effects.bevel);if(!bevel)return null;out.bevel=bevel;any=true;}
  if(effects.gradientOverlay?.enabled){const gradient=gradientRecord(effects.gradientOverlay);if(!gradient)return null;out.gradientOverlay=[gradient];any=true;}
  if(effects.satin?.enabled){const satin=satinRecord(effects.satin);if(!satin)return null;out.satin=satin;any=true;}
  if(effects.overlay?.enabled){const color=rgb(effects.overlay.color),opacity=Number(effects.overlay.opacity??1);if(!color||!Number.isFinite(opacity)||opacity<0||opacity>1)return null;out.solidFill=[{enabled:true,present:true,showInDialog:true,blendMode:'normal',opacity,color}];any=true;}
  if(effects.shadow?.enabled){const shadow=shadowRecord(effects.shadow,'multiply');if(!shadow)return null;out.dropShadow=[shadow];any=true;}
  if(effects.innerShadow?.enabled){const shadow=shadowRecord(effects.innerShadow,'multiply');if(!shadow)return null;out.innerShadow=[shadow];any=true;}
  if(effects.outerGlow?.enabled){const glow=glowRecord(effects.outerGlow,'screen');if(!glow)return null;out.outerGlow=glow;any=true;}
  if(effects.innerGlow?.enabled){const glow=glowRecord(effects.innerGlow,'screen');if(!glow)return null;out.innerGlow=glow;any=true;}
  if(effects.stroke?.enabled){const color=rgb(effects.stroke.color),size=Number(effects.stroke.size);if(!color||!Number.isFinite(size))return null;out.stroke=[{enabled:true,present:true,showInDialog:true,position:'outside',fillType:'color',blendMode:'normal',opacity:1,size:px(size),color}];any=true;}
  return any?out:{};
}
