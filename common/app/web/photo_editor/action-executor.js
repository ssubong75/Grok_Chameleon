// Explicit replayable subset. Calls existing document methods without swallowing errors.
import {actionCommands,actionParams} from './action-state.js';
export function executeActionStep(id,{getDocument,available,fit,setZoom,getZoom,draw},params={}){
  if(!actionCommands.has(id))throw Error('Unsupported action command: '+id);
  params=actionParams(id,params);const d=getDocument();if(!d||!available(id))throw Error('Command is unavailable: '+id);
  if(id==='layer.setProps'){const layers=d.selectedLayers;if(!d.active||!layers.length||layers.some(layer=>d.isLocked(layer)))throw Error('Select unlocked layers before changing opacity or fill.');const field=Object.hasOwn(params,'fill')?'fillOpacity':'opacity',value=params.fill??params.opacity;if(!layers.some(layer=>(layer[field]??1)!==value))return;d.checkpoint(field==='fillOpacity'?'Fill Opacity':'Layer Opacity');for(const layer of layers)layer[field]=value;d.changed();}
  else if(id==='layer.rename'){if(!d.active)throw Error('Select a layer to rename.');d.checkpoint('Rename Layer');d.active.name=params.name;d.changed();}
  else if(id==='select.all')d.setSelection({x:0,y:0,w:d.width,h:d.height,kind:'rect'});
  else if(id==='select.none')d.setSelection(null);
  else if(id==='select.inverse')d.setSelection(d.selection?{...d.selection,inverse:!d.selection.inverse}:{x:0,y:0,w:d.width,h:d.height,kind:'rect'});
  else if(id==='image.cw'||id==='image.ccw'){d.rotate(id==='image.cw'?1:-1);fit();}
  else if(id==='image.rotate180'){d.rotate180();fit();}
  else if(id==='image.flipH'||id==='image.flipV')d.flip(id==='image.flipH');
  else if(id==='view.fit')fit();
  else if(id==='view.actual')setZoom(1);
  else if(id==='view.in'||id==='view.out')setZoom(getZoom()*(id==='view.in'?1.25:1/1.25));
  draw();
}
