import {parseStops} from './gradient-renderer.js';
const blendOptions=[['source-over','Normal'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],['soft-light','Soft Light'],['color','Color']];
const definitions=[
  ['innerShadow','Inner Shadow',{color:'#000000',opacity:.75,blur:5,spread:0,noise:0,distance:5,angle:120,blend:'multiply'}],
  ['outerGlow','Outer Glow',{color:'#ffffbe',opacity:.75,blur:5,spread:0,noise:0,range:50,technique:'softer',blend:'screen'}],
  ['innerGlow','Inner Glow',{color:'#ffffbe',opacity:.75,blur:5,spread:0,noise:0,range:50,technique:'softer',source:'edge',blend:'screen'}],
  ['satin','Satin',{color:'#000000',opacity:.5,angle:19,distance:11,size:14,invert:true,blend:'multiply'}],
  ['bevel','Bevel and Emboss',{style:'inner',technique:'smooth',depth:100,size:5,soften:0,angle:120,altitude:30,up:true,highlightColor:'#ffffff',shadowColor:'#000000',highlight:75,shadow:75}],
  ['gradientOverlay','Gradient Overlay',{colorA:'#000000',colorB:'#ffffff',opacity:1,angle:90,scale:100,style:'linear',reverse:false,stops:'',blend:'source-over'}],
  ['patternOverlay','Pattern Overlay',{colorA:'#000000',colorB:'#ffffff',opacity:1,angle:0,scale:100,style:'checkerboard',cell:24,blend:'source-over'}],
];
export function extraEffectFields(old){
  const fields=[],labels={color:'Color',colorA:'First Color',colorB:'Second Color',opacity:'Opacity (%)',blur:'Size (px)',size:'Size (px)',distance:'Distance (px)',angle:'Angle (°)',scale:'Scale (%)',style:'Style',reverse:'Reverse',noise:'Noise (%)',spread:'Spread / Choke (%)',range:'Range (%)',technique:'Technique',source:'Glow Source',stops:'Color Stops (position%:#RRGGBB)',cell:'Pattern Cell (px)',blend:'Blend Mode',depth:'Depth (%)',soften:'Soften (px)',altitude:'Altitude (°)',up:'Direction Up',highlightColor:'Highlight Color',shadowColor:'Shadow Color',highlight:'Highlight Opacity (%)',shadow:'Shadow Opacity (%)',invert:'Invert'};
  for(const [id,label,defaults]of definitions){const settings={...defaults,...old[id]};fields.push({text:label},{key:id+'.enabled',label:'Enable '+label,type:'checkbox',value:Boolean(settings.enabled)});
    for(const [key,value]of Object.entries(defaults)){const field={key:id+'.'+key,label:labels[key]||key,value:key==='opacity'?settings[key]*100:settings[key]};
      if(key==='blend')field.options=blendOptions;
      else if(key==='style')field.options=id==='bevel'?[['inner','Inner Bevel'],['outer','Outer Bevel'],['emboss','Emboss'],['pillow','Pillow Emboss'],['stroke','Stroke Emboss']]:id==='gradientOverlay'?[['linear','Linear'],['radial','Radial'],['angle','Angle'],['reflected','Reflected'],['diamond','Diamond']]:[...(settings.tile?[['custom','Embedded Pattern']]:[]),['checkerboard','Checkerboard'],['stripes','Stripes'],['dots','Dots']];
      else if(typeof value==='boolean')field.type='checkbox';
      else if(key==='technique')field.options=id==='bevel'?[['smooth','Smooth'],['chisel hard','Chisel Hard'],['chisel soft','Chisel Soft']]:[['softer','Softer'],['precise','Precise']];
      else if(key==='source')field.options=[['edge','Edge'],['center','Center']];
      else if(key==='stops')field.type='text';
      else if(/color/i.test(key))field.type='color';
      else{field.type='number';if(['opacity','highlight','shadow','range','spread','noise'].includes(key)){field.min=key==='range'?1:0;field.max=100;}else if(['blur','distance','size','soften'].includes(key)){field.min=0;field.max=250;}else if(['scale','depth'].includes(key)){field.min=key==='depth'?0:1;field.max=1000;}else if(key==='cell'){field.min=2;field.max=1000;}else if(key==='altitude'){field.min=0;field.max=90;}}
      fields.push(field);
    }
    if(id==='bevel'&&settings.texture){const t=settings.texture;fields.push({text:'Embedded Bevel Texture'},
      {key:'bevel.textureScale',label:'Texture Scale (%)',type:'number',value:t.scale*100,min:.1,step:.1},
      {key:'bevel.textureDepth',label:'Texture Depth (%)',type:'number',value:t.depth*100,step:1},
      {key:'bevel.textureInvert',label:'Invert Texture',type:'checkbox',value:Boolean(t.invert)},
      {key:'bevel.textureLink',label:'Link Texture with Layer',type:'checkbox',value:t.link!==false},
      {key:'bevel.textureX',label:'Texture Phase X (px)',type:'number',value:t.phase?.x??0,step:.1},
      {key:'bevel.textureY',label:'Texture Phase Y (px)',type:'number',value:t.phase?.y??0,step:.1});}
  }return fields;
}
export function extraEffectValues(values,old={}){const result={};for(const [id,,defaults]of definitions){const setting={enabled:Boolean(values[id+'.enabled'])};for(const [key,value]of Object.entries(defaults)){let v=values[id+'.'+key];if(typeof value==='number'){v=Number(v);if(!Number.isFinite(v))v=value;if(key==='opacity')v=Math.max(0,Math.min(1,v/100));}setting[key]=v;}if(old[id]?.contour)setting.contour=structuredClone(old[id].contour);if(old[id]?.texture){setting.texture=structuredClone(old[id].texture);if(id==='bevel'){const scale=Number(values['bevel.textureScale'])/100,depth=Number(values['bevel.textureDepth'])/100,x=Number(values['bevel.textureX']),y=Number(values['bevel.textureY']);if(![scale,depth,x,y].every(Number.isFinite)||scale<.001)throw Error('Enter a positive texture scale and finite texture values.');Object.assign(setting.texture,{scale,depth,phase:{x,y},invert:Boolean(values['bevel.textureInvert']),link:Boolean(values['bevel.textureLink'])});}}if(old[id]?.heightContour){setting.heightContour=structuredClone(old[id].heightContour);setting.heightRange=old[id].heightRange;}if(id==='patternOverlay'&&setting.style==='custom'&&old[id]?.tile)setting.tile=old[id].tile;result[id]=setting;}if(result.gradientOverlay?.enabled)parseStops(result.gradientOverlay.stops,result.gradientOverlay.colorA,result.gradientOverlay.colorB);return result;}
