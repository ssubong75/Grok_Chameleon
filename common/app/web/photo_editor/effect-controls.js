const blendOptions=[['source-over','Normal'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],['soft-light','Soft Light'],['color','Color']];
const definitions=[
  ['innerShadow','Inner Shadow',{color:'#000000',opacity:.75,blur:5,distance:5,angle:120,blend:'multiply'}],
  ['outerGlow','Outer Glow',{color:'#ffffbe',opacity:.75,blur:5,blend:'screen'}],
  ['innerGlow','Inner Glow',{color:'#ffffbe',opacity:.75,blur:5,blend:'screen'}],
  ['satin','Satin',{color:'#000000',opacity:.5,angle:19,distance:11,size:14,invert:true,blend:'multiply'}],
  ['bevel','Bevel and Emboss',{style:'inner',depth:100,size:5,soften:0,angle:120,altitude:30,up:true,highlightColor:'#ffffff',shadowColor:'#000000',highlight:75,shadow:75}],
  ['gradientOverlay','Gradient Overlay',{colorA:'#000000',colorB:'#ffffff',opacity:1,angle:90,scale:100,style:'linear',reverse:false,blend:'source-over'}],
  ['patternOverlay','Pattern Overlay',{colorA:'#000000',colorB:'#ffffff',opacity:1,angle:0,scale:100,style:'checkerboard',cell:24,blend:'source-over'}],
];
export function extraEffectFields(old){
  const fields=[],labels={color:'Color',colorA:'First Color',colorB:'Second Color',opacity:'Opacity (%)',blur:'Size (px)',size:'Size (px)',distance:'Distance (px)',angle:'Angle (°)',scale:'Scale (%)',style:'Style',reverse:'Reverse',cell:'Pattern Cell (px)',blend:'Blend Mode',depth:'Depth (%)',soften:'Soften (px)',altitude:'Altitude (°)',up:'Direction Up',highlightColor:'Highlight Color',shadowColor:'Shadow Color',highlight:'Highlight Opacity (%)',shadow:'Shadow Opacity (%)',invert:'Invert'};
  for(const [id,label,defaults]of definitions){const settings={...defaults,...old[id]};fields.push({text:label},{key:id+'.enabled',label:'Enable '+label,type:'checkbox',value:Boolean(settings.enabled)});
    for(const [key,value]of Object.entries(defaults)){const field={key:id+'.'+key,label:labels[key]||key,value:key==='opacity'?settings[key]*100:settings[key]};
      if(key==='blend')field.options=blendOptions;
      else if(key==='style')field.options=id==='bevel'?[['inner','Inner Bevel'],['outer','Outer Bevel'],['emboss','Emboss'],['pillow','Pillow Emboss']]:id==='gradientOverlay'?[['linear','Linear'],['radial','Radial'],['angle','Angle'],['reflected','Reflected'],['diamond','Diamond']]:[['checkerboard','Checkerboard'],['stripes','Stripes'],['dots','Dots']];
      else if(typeof value==='boolean')field.type='checkbox';
      else if(/color/i.test(key))field.type='color';
      else{field.type='number';if(['opacity','highlight','shadow'].includes(key)){field.min=0;field.max=100;}else if(['blur','distance','size','soften'].includes(key)){field.min=0;field.max=250;}else if(['scale','depth'].includes(key)){field.min=key==='depth'?0:1;field.max=1000;}else if(key==='cell'){field.min=2;field.max=1000;}else if(key==='altitude'){field.min=0;field.max=90;}}
      fields.push(field);
    }
  }return fields;
}
export function extraEffectValues(values){const result={};for(const [id,,defaults]of definitions){const setting={enabled:Boolean(values[id+'.enabled'])};for(const [key,value]of Object.entries(defaults)){let v=values[id+'.'+key];if(typeof value==='number'){v=Number(v);if(!Number.isFinite(v))v=value;if(key==='opacity')v=Math.max(0,Math.min(1,v/100));}setting[key]=v;}result[id]=setting;}return result;}
