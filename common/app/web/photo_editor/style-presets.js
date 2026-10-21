function percent(value,fallback){return value==null?fallback:value/100;}
function shadowLike(params,extra={}){return {enabled:true,color:params.color||'#000000',opacity:percent(params.opacity,.75),blur:params.size??extra.blur??8,distance:params.distance??extra.distance??8,angle:params.angle??extra.angle??120,blend:params.blend||extra.blend||'multiply',spread:params.spread??0,noise:params.noise??0};}
function effectOf(kind,params){
  if(kind==='dropShadow')return ['shadow',shadowLike(params)];
  if(kind==='innerShadow')return ['innerShadow',shadowLike(params,{angle:120})];
  if(kind==='outerGlow')return ['outerGlow',{enabled:true,color:params.color||'#ffffbe',opacity:percent(params.opacity,.75),blur:params.size??5,spread:0,noise:0,range:50,technique:'softer',blend:params.blend||'screen'}];
  if(kind==='innerGlow')return ['innerGlow',{enabled:true,color:params.color||'#ffffbe',opacity:percent(params.opacity,.75),blur:params.size??5,spread:0,noise:0,range:50,technique:'softer',source:'edge',blend:params.blend||'screen'}];
  if(kind==='stroke')return ['stroke',{enabled:true,color:params.color||'#000000',size:params.size??3,position:params.position||'outside'}];
  if(kind==='colorOverlay')return ['overlay',{enabled:true,color:params.color||'#ff0000',opacity:params.opacity==null?1:params.opacity/100}];
  if(kind==='gradientOverlay')return ['gradientOverlay',{enabled:true,colorA:params.from||'#000000',colorB:params.to||'#ffffff',opacity:1,angle:params.angle??90,scale:100,style:'linear',reverse:false,stops:'',blend:'source-over'}];
  if(kind==='bevelEmboss')return ['bevel',{enabled:true,style:params.style||'inner',technique:'smooth',depth:params.depth??100,size:params.size??5,soften:params.soften??0,angle:120,altitude:30,up:true,highlightColor:'#ffffff',shadowColor:'#000000',highlight:75,shadow:75}];
  if(kind==='satin')return ['satin',{enabled:true,color:params.color||'#000000',opacity:percent(params.opacity,.5),angle:19,distance:params.distance??11,size:params.size??14,invert:true,blend:'multiply'}];
  throw Error('unknown effect '+kind);
}
function style(name,effects,fillOpacity=null){const out={enabled:true};for(const [kind,params] of effects){const [key,value]=effectOf(kind,params);out[key]=value;}return {name,effects:out,blend:null,fillOpacity};}
export function builtinStyleGroups(){return [
  {name:'Basics',items:[
    style('Default Style (None)',[]),
    style('Drop Shadow',[['dropShadow',{distance:6,size:8,opacity:60}]]),
    style('Soft Shadow',[['dropShadow',{distance:2,size:16,opacity:45}]]),
    style('Black Stroke',[['stroke',{size:3,color:'#000000',position:'outside'}]]),
    style('White Stroke',[['stroke',{size:3,color:'#ffffff',position:'outside'}]]),
    style('Inner Shadow',[['innerShadow',{distance:4,size:6,opacity:55}]]),
    style('Outer Glow',[['outerGlow',{size:14,color:'#ffe9a8',opacity:80}]]),
    style('Emboss',[['bevelEmboss',{style:'emboss',size:4,depth:120}]])
  ]},
  {name:'Text Effects',items:[
    style('Neon Blue',[['colorOverlay',{color:'#d8f4ff'}],['innerGlow',{color:'#3fb6ff',size:6,opacity:90,blend:'normal'}],['outerGlow',{color:'#1e90ff',size:22,opacity:90}]]),
    style('Neon Pink',[['colorOverlay',{color:'#ffe1f3'}],['innerGlow',{color:'#ff4fb4',size:6,opacity:90,blend:'normal'}],['outerGlow',{color:'#ff2d95',size:22,opacity:90}]]),
    style('Chrome',[['gradientOverlay',{from:'#3a3f47',to:'#f4f6f8',angle:90}],['bevelEmboss',{style:'inner',size:6,depth:250,soften:1}],['stroke',{size:1,color:'#2a2d33',position:'outside'}]]),
    style('Gold',[['gradientOverlay',{from:'#8a5a12',to:'#ffe08a',angle:90}],['bevelEmboss',{style:'inner',size:5,depth:180}],['dropShadow',{distance:3,size:5,opacity:50}]]),
    style('Comic Outline',[['colorOverlay',{color:'#ffd23f'}],['stroke',{size:4,color:'#111111',position:'outside'}],['dropShadow',{distance:6,size:0,opacity:100,angle:135}]]),
    style('Letterpress',[['colorOverlay',{color:'#5b6168'}],['innerShadow',{distance:2,size:2,opacity:70}],['dropShadow',{distance:1,size:0,color:'#ffffff',opacity:60,blend:'screen',angle:90}]]),
    style('Hollow',[['stroke',{size:2,color:'#222222',position:'inside'}]],0)
  ]},
  {name:'Buttons',items:[
    style('Glass',[['gradientOverlay',{from:'#2b6cb0',to:'#90cdf4',angle:90}],['innerGlow',{color:'#ffffff',size:6,opacity:45,blend:'screen'}],['bevelEmboss',{style:'inner',size:8,depth:100,soften:4}],['dropShadow',{distance:3,size:8,opacity:40}]]),
    style('Gel Green',[['gradientOverlay',{from:'#1f7a3a',to:'#7be495',angle:90}],['innerShadow',{distance:2,size:5,opacity:35}],['bevelEmboss',{style:'inner',size:10,depth:150,soften:6}]]),
    style('Pressed',[['colorOverlay',{color:'#d7dbe0'}],['innerShadow',{distance:3,size:6,opacity:60}],['stroke',{size:1,color:'#9aa1a9',position:'inside'}]]),
    style('Pill Red',[['gradientOverlay',{from:'#9b1c1c',to:'#f87171',angle:90}],['bevelEmboss',{style:'pillow',size:6,depth:120}],['dropShadow',{distance:2,size:4,opacity:45}]]),
    style('Flat Shadow',[['colorOverlay',{color:'#3b82f6'}],['dropShadow',{distance:5,size:0,opacity:35,angle:90}]]),
    style('Satin Plum',[['colorOverlay',{color:'#7e3a8c'}],['satin',{color:'#1b0420',opacity:55,size:18,distance:14}],['bevelEmboss',{style:'inner',size:4,depth:80}]])
  ]}
];}
function findStyle(groups,name,group){for(const item of groups||[]){if(group&&item.name!==group)continue;const found=item.items.find(style=>style.name===name);if(found)return found;}return null;}
export function applyStylePreset(doc,groups,name,{add=false,group=null}={}){
  const style=findStyle(groups,name,group);if(!style)throw Error('style.presets.apply: no style "'+name+'" (see style.presets.list)');
  const layers=doc.selectedLayers||[];if(!layers.length)throw Error('style.presets.apply: no target layers');
  doc.checkpoint('Apply Style: '+style.name);
  for(const layer of layers){
    if(layer.kind==='adjustment')continue;
    if(!layer.kind&&layer.lockAlpha&&layer.lockPosition){layer.lockAlpha=false;layer.lockPosition=false;layer.locked=false;if(layer.name==='Background')layer.name='Layer 0';}
    const next=add?{...(layer.effects||{}),enabled:true}:{enabled:true};
    for(const [key,effect] of Object.entries(style.effects))if(key!=='enabled'&&effect?.enabled)next[key]=structuredClone(effect);
    layer.effects=next;
    if(!add||style.blend){if(style.blend)layer.blend=style.blend;if(style.fillOpacity!=null)layer.fillOpacity=style.fillOpacity;else if(!add)layer.fillOpacity=1;}
  }
  doc.changed();
  return {layers:layers.map(layer=>layer.id),style:style.name};
}
function uniqueName(groups,base){const taken=name=>(groups||[]).some(group=>group.items.some(item=>item.name===name));if(!taken(base))return base;for(let i=2;i<100000;i++)if(!taken(base+' '+i))return base+' '+i;return base;}
export function newStylePreset(groups,layer,{name='Style',group=null,includeEffects=true,includeBlending=true}={}){
  if(!includeEffects&&!includeBlending)throw Error('style.presets.new: include effects and/or blending options');
  const label=uniqueName(groups,name||'Style');
  const made={name:label,effects:includeEffects?structuredClone(layer?.effects||{enabled:true}):{enabled:true},blend:includeBlending?layer?.blend||null:null,fillOpacity:includeBlending?layer?.fillOpacity??1:null};
  let target=group?groups.find(item=>item.name===group):groups[0];
  if(!target){target={name:group||'Presets',items:[]};groups.push(target);}
  target.items.push(made);
  return {name:label,group:target.name,effects:Object.values(made.effects).filter(effect=>effect?.enabled).length};
}
