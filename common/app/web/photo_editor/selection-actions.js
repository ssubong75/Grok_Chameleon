import {surface,EditorDocument} from './engine.js';
import {alphaSelection} from './selections.js';
import {SelectionTask} from './selection-task.js';
import {RefineView} from './refine-selection-ui.js';
export async function selectionAction(id,{getDocument,showDialog,attach}){
  const d=getDocument();if(!d)return;
  if(!d.selection)throw Error('Select an area first.');
  const layer=d.active,coverage=d.selectionCoverage(),sources=new Map();
  const source=all=>{if(sources.has(all))return sources.get(all);const canvas=surface(d.width,d.height);if(all||!layer||['group','adjustment'].includes(layer.kind))canvas.getContext('2d').drawImage(d.composite(),0,0);else canvas.getContext('2d').drawImage(layer.canvas,layer.x,layer.y);sources.set(all,canvas);return canvas;};
  let settings={},operation=id.split('.').at(-1);
  if(operation==='refine'){
    const pending=showDialog('Refine Edge',[],true),dialog=document.querySelector('#dialog');dialog.classList.add('refine-dialog');const view=new RefineView(document.querySelector('#dialog-body'),source,coverage);let accepted;
    try{accepted=await pending;if(accepted)settings=view.read();}finally{view.dispose();dialog.classList.remove('refine-dialog');}if(!accepted)return;
  }else{const fields=operation==='smooth'?[{key:'radius',label:'Sample Radius (px)',type:'number',min:1,max:500,value:5}]:[{key:'tolerance',label:'Tolerance',type:'number',min:0,max:255,value:32},{key:'sampleAll',label:'Sample All Layers',type:'checkbox',value:false}];const values=await showDialog(operation==='smooth'?'Smooth Selection':operation==='grow'?'Grow Selection':'Similar Colors',fields);if(!values)return;settings=values;for(const field of fields)if(field.type==='number'){settings[field.key]=Number(values[field.key]);if(!Number.isFinite(settings[field.key])||settings[field.key]<field.min||settings[field.key]>field.max)throw Error('Enter a valid '+field.label+'.');}}
  if(getDocument()!==d||d.active!==layer)return;
  if(settings.output==='layerMask'&&(!layer||d.isLocked(layer)||['group','adjustment'].includes(layer.kind)))throw Error('Select an unlocked image layer for the layer mask output.');
  const task=new SelectionTask();let complete=false;const pending=showDialog('Applying Selection',[{text:'Processing selection… Cancel to keep the original selection.'}],false);pending.then(()=>{if(!complete)task.cancel();});let result;
  try{result=await task.run(source(!!settings.sampleAll),coverage,operation,settings);}catch(error){if(error.name!=='AbortError')throw error;return;}finally{complete=true;task.cancel();const dialog=document.querySelector('#dialog');if(dialog.open)dialog.close('done');await pending;}
  if(getDocument()!==d||d.active!==layer)return;
  const output=settings.output||'selection';if(output==='selection'){d.setSelection(alphaSelection(result.mask,d.width,d.height));return;}
  const mask=surface(d.width,d.height),maskContext=mask.getContext('2d'),pixels=maskContext.createImageData(d.width,d.height);for(let i=0;i<result.mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=result.mask[i];}maskContext.putImageData(pixels,0,0);
  if(output==='layerMask'){d.checkpoint('Refine Layer Mask');layer.mask=mask;layer.maskOffsetX=-layer.x;layer.maskOffsetY=-layer.y;layer.editMask=true;d.previousSelection=structuredClone(d.selection);d.selection=null;d.changed();return;}
  const image=surface(d.width,d.height),context=image.getContext('2d');if(result.image)context.putImageData(result.image,0,0);else context.drawImage(source(!!settings.sampleAll),0,0);const withMask=output.endsWith('WithMask');if(!withMask){context.globalCompositeOperation='destination-in';context.drawImage(mask,0,0);context.globalCompositeOperation='source-over';}
  const newDocument=output.startsWith('newDocument'),target=newDocument?new EditorDocument(d.width,d.height,d.name+' refined'):d;if(!newDocument)target.checkpoint('Refine Selection Output');const created=target.addLayer((layer?.name||'Selection')+' refined',image,false);if(withMask){created.mask=mask;created.maskOffsetX=0;created.maskOffsetY=0;}if(!newDocument){target.previousSelection=structuredClone(target.selection);target.selection=null;}target.changed();if(newDocument)attach(target);
}
