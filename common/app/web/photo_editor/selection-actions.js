import {ColorRangeView} from './color-range-ui.js';
import {surface,EditorDocument} from './engine.js';
import {alphaSelection} from './selections.js';
import {SelectionTask} from './selection-task.js';
import {RefineView} from './refine-selection-ui.js';
export async function removeBackground({getDocument,showDialog}){
  const d=getDocument(),layer=d?.active;if(!layer||layer.kind||layer.text||layer.shape||d.isLocked(layer)||layer.lockPixels)throw Error('Select an unlocked pixel layer.');
  const revision=d.revision,canvas=surface(d.width,d.height);canvas.getContext('2d').drawImage(layer.canvas,layer.x,layer.y);
  const task=new SelectionTask();let complete=false;
  const pending=showDialog('Remove Background',[{text:'Processing…'}],false);pending.then(()=>{if(!complete)task.cancel();});let result;
  try{result=await task.run(canvas,new Uint8ClampedArray(0),'removeBackground',{});}catch(error){if(error.name==='AbortError')return;throw error;}finally{complete=true;task.cancel();const dialog=document.querySelector('#dialog');if(dialog.open)dialog.close('done');await pending;}
  if(getDocument()!==d||d.active!==layer||d.revision!==revision)return;
  const mask=surface(d.width,d.height),ctx=mask.getContext('2d'),pixels=ctx.createImageData(d.width,d.height);
  for(let i=0;i<result.mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=result.mask[i];}ctx.putImageData(pixels,0,0);
  d.checkpoint('Remove Background');if(!layer.parentId&&layer.lockAlpha&&layer.lockPosition){layer.name='Layer 0';layer.lockAlpha=false;layer.lockPosition=false;}
  layer.mask=mask;layer.maskOffsetX=-layer.x;layer.maskOffsetY=-layer.y;layer.maskLinked=true;layer.maskDisabled=false;layer.maskDensity=1;layer.maskFeather=0;d.selection=null;d.changed();
}
export async function selectionAction(id,{getDocument,showDialog,attach,initialSettings=null,coverageOverride=null,refineOutput='selection'}){
  const d=getDocument();if(!d)return;
  const operation=id.split('.').at(-1);
  if(!d.selection&&!coverageOverride&&!['sky','subject','object','colorRange','focus','quick','objectAt','wand'].includes(operation))throw Error('Select an area first.');
  const layer=d.active,coverage=coverageOverride|| (d.selection?d.selectionCoverage():new Uint8ClampedArray(0)),sources=new Map();
  const source=all=>{if(sources.has(all))return sources.get(all);const canvas=surface(d.width,d.height);if(all||!layer||['group','adjustment'].includes(layer.kind))canvas.getContext('2d').drawImage(d.composite(),0,0);else canvas.getContext('2d').drawImage(layer.canvas,layer.x,layer.y);sources.set(all,canvas);return canvas;};
  let settings=initialSettings?structuredClone(initialSettings):{};
  if(initialSettings){
    if(!['object','quick','objectAt','wand'].includes(operation))throw Error('Unsupported direct selection operation.');
  }else if(operation==='colorRange'){
    const pending=showDialog('Color Range',[{key:'preset',label:'Select',options:[['sampled','Sampled Colors'],['reds','Reds'],['yellows','Yellows'],['greens','Greens'],['cyans','Cyans'],['blues','Blues'],['magentas','Magentas'],['skin','Skin Tones'],['shadows','Shadows'],['midtones','Midtones'],['highlights','Highlights']],value:'sampled'},{key:'fuzziness',label:'Fuzziness',type:'number',min:0,max:200,value:40},{key:'toneLow',label:'Shadow Cutoff',type:'number',min:0,max:255,value:75},{key:'toneHigh',label:'Highlight Cutoff',type:'number',min:0,max:255,value:190},{key:'localized',label:'Localized Color Clusters',type:'checkbox',value:false},{key:'localizedRadius',label:'Cluster Radius (px)',type:'number',min:1,max:100000,value:Math.max(1,Math.round(Math.min(d.width,d.height)/4))},{key:'invert',label:'Invert',type:'checkbox',value:false},{key:'combine',label:'Selection',options:[['replace','Replace'],['add','Add'],['subtract','Subtract'],['intersect','Intersect']],value:'replace'}],true),view=new ColorRangeView(document.querySelector('#dialog-body'),source(true),d.selection?coverage:null);let accepted;
    try{accepted=await pending;if(accepted)settings={...view.read(),sampleAll:true,combine:accepted.combine};}finally{view.dispose();}if(!accepted)return;
  }else if(operation==='subject'||operation==='object'){
    const area=d.selection&&!d.selection.inverse?d.selection:{x:Math.floor(d.width*.1),y:Math.floor(d.height*.1),w:Math.max(2,Math.floor(d.width*.8)),h:Math.max(2,Math.floor(d.height*.8))};
    const fields=operation==='object'?[{key:'x',label:'Left (px)',type:'number',min:0,max:d.width-2,value:Math.max(0,area.x)},{key:'y',label:'Top (px)',type:'number',min:0,max:d.height-2,value:Math.max(0,area.y)},{key:'width',label:'Width (px)',type:'number',min:2,max:d.width,value:Math.min(d.width,Math.max(2,area.w))},{key:'height',label:'Height (px)',type:'number',min:2,max:d.height,value:Math.min(d.height,Math.max(2,area.h))}]:[];
    fields.push({key:'sampleAll',label:'Sample All Layers',type:'checkbox',value:true},{key:'combine',label:'Selection',options:[['replace','Replace'],['add','Add'],['subtract','Subtract'],['intersect','Intersect']],value:'replace'});
    const values=await showDialog(operation==='object'?'Select Object':'Select Subject',fields);if(!values)return;for(const field of fields)if(field.type==='number'){values[field.key]=Number(values[field.key]);if(!Number.isFinite(values[field.key])||values[field.key]<field.min||values[field.key]>field.max)throw Error('Enter a valid '+field.label+'.');}settings=values;
  }else if(operation==='focus'){
    const values=await showDialog('Focus Area',[{key:'range',label:'In-Focus Range (%)',type:'number',min:0,max:100,value:50},{key:'noise',label:'Image Noise (%)',type:'number',min:0,max:100,value:0},{key:'sampleAll',label:'Sample All Layers',type:'checkbox',value:true},{key:'combine',label:'Selection',options:[['replace','Replace'],['add','Add'],['subtract','Subtract'],['intersect','Intersect']],value:'replace'}]);if(!values)return;for(const key of ['range','noise']){values[key]=Number(values[key])/100;if(!Number.isFinite(values[key])||values[key]<0||values[key]>1)throw Error('Choose a percentage from 0 to 100.');}settings=values;
  }else if(operation==='sky'){
    const values=await showDialog('Select Sky',[{key:'threshold',label:'Threshold (%)',type:'number',min:0,max:100,value:50},{key:'softness',label:'Edge Softness (%)',type:'number',min:0,max:100,value:50},{key:'sampleAll',label:'Sample All Layers',type:'checkbox',value:true},{key:'combine',label:'Selection',options:[['replace','Replace'],['add','Add'],['subtract','Subtract'],['intersect','Intersect']],value:'replace'}]);if(!values)return;
    for(const key of ['threshold','softness']){values[key]=Number(values[key]);if(!Number.isFinite(values[key])||values[key]<0||values[key]>100)throw Error('Choose a percentage from 0 to 100.');}settings=values;
  }else
  if(operation==='refine'){
    const pending=showDialog('Refine Edge',[],true),dialog=document.querySelector('#dialog');dialog.classList.add('refine-dialog');const view=new RefineView(document.querySelector('#dialog-body'),source,coverage,{output:refineOutput});let accepted;
    try{accepted=await pending;if(accepted)settings=view.read();}finally{view.dispose();dialog.classList.remove('refine-dialog');}if(!accepted)return;
  }else{
    const morphology=['feather','expand','contract','border'].includes(operation);
    const fields=morphology?[{key:'amount',label:'Radius (px)',type:'number',min:operation==='feather'?.1:1,max:operation==='feather'?1000:operation==='border'?200:500,step:'any',value:5},
      ...(operation!=='feather'?[{key:'shape',label:'Corners',options:[['rounded','Rounded'],['square','Square']],value:'rounded'}]:[]),
      ...(operation==='border'?[{key:'placement',label:'Border Position',options:[['center','Centered'],['inside','Inside'],['outside','Outside']],value:'center'}]:[]),
      ...(operation!=='border'?[{key:'canvasBounds',label:'Apply at Canvas Bounds',type:'checkbox',value:false}]:[])]:operation==='smooth'?[{key:'radius',label:'Sample Radius (px)',type:'number',min:1,max:500,value:5}]:[{key:'tolerance',label:'Tolerance',type:'number',min:0,max:255,value:32},{key:'sampleAll',label:'Sample All Layers',type:'checkbox',value:false}];
    const title=morphology?({feather:'Feather Selection',expand:'Expand Selection',contract:'Contract Selection',border:'Selection Border'})[operation]:operation==='smooth'?'Smooth Selection':operation==='grow'?'Grow Selection':'Similar Colors';
    const values=await showDialog(title,fields);if(!values)return;settings=values;
    for(const field of fields)if(field.type==='number'){settings[field.key]=Number(values[field.key]);if(!Number.isFinite(settings[field.key])||settings[field.key]<field.min||settings[field.key]>field.max)throw Error('Enter a valid '+field.label+'.');}
  }
  if(getDocument()!==d||d.active!==layer)return;
  if(settings.output==='layerMask'&&(!layer||d.isLocked(layer)||['group','adjustment'].includes(layer.kind)))throw Error('Select an unlocked image layer for the layer mask output.');
  const task=new SelectionTask();let complete=false;const pending=showDialog('Applying Selection',[{text:'Processing selection… Cancel to keep the original selection.'}],false);pending.then(()=>{if(!complete)task.cancel();});let result;
  try{result=await (['feather','expand','contract','border','smooth'].includes(operation)?task.runMask(coverage,d.width,d.height,operation,settings):task.run(source(!!settings.sampleAll),coverage,operation,settings));}catch(error){if(error.name!=='AbortError')throw error;return;}finally{complete=true;task.cancel();const dialog=document.querySelector('#dialog');if(dialog.open)dialog.close('done');await pending;}
  if(getDocument()!==d||d.active!==layer)return;
  const output=settings.output||'selection';if(output==='selection'){d.setSelection(alphaSelection(result.mask,d.width,d.height),settings.combine||'replace');return;}
  const mask=surface(d.width,d.height),maskContext=mask.getContext('2d'),pixels=maskContext.createImageData(d.width,d.height);for(let i=0;i<result.mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=result.mask[i];}maskContext.putImageData(pixels,0,0);
  if(output==='layerMask'){d.checkpoint('Refine Layer Mask');layer.mask=mask;layer.maskOffsetX=-layer.x;layer.maskOffsetY=-layer.y;layer.editMask=true;d.previousSelection=structuredClone(d.selection);d.selection=null;d.changed();return;}
  const image=surface(d.width,d.height),context=image.getContext('2d');if(result.image)context.putImageData(result.image,0,0);else context.drawImage(source(!!settings.sampleAll),0,0);const withMask=output.endsWith('WithMask');if(!withMask){context.globalCompositeOperation='destination-in';context.drawImage(mask,0,0);context.globalCompositeOperation='source-over';}
  const newDocument=output.startsWith('newDocument'),target=newDocument?new EditorDocument(d.width,d.height,d.name+' refined'):d;if(!newDocument)target.checkpoint('Refine Selection Output');const created=target.addLayer((layer?.name||'Selection')+' refined',image,false);if(withMask){created.mask=mask;created.maskOffsetX=0;created.maskOffsetY=0;}if(!newDocument){target.previousSelection=structuredClone(target.selection);target.selection=null;}target.changed();if(newDocument)attach(target);
}
