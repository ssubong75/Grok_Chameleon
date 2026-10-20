// PhotoCraft eraser_cmds.rs / algo/erase.rs, 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {surface,copyCanvas} from './engine.js';
import {SelectionTask} from './selection-task.js';
export async function magicEraser({getDocument,point,settings,background,showDialog}){
  const d=getDocument(),layer=d?.active;
  if(!layer||d.channelTarget||layer.editMask||layer.text||layer.shape||layer.fill||['group','adjustment','smart'].includes(layer.kind)||d.isLocked(layer))throw Error('Select an unlocked raster layer image for Magic Eraser.');
  const x=Math.floor(point.x),y=Math.floor(point.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=d.width||y>=d.height)return;
  const tolerance=Number(settings.tolerance),opacity=Number(settings.opacity);if(!Number.isFinite(tolerance)||tolerance<0||tolerance>255||!Number.isFinite(opacity)||opacity<1||opacity>100)throw Error('Enter valid Magic Eraser tolerance and opacity.');
  const revision=d.revision,original=layer.canvas,selection=d.selection?d.selectionCoverage():null,locked=d.isAlphaLocked(layer),sample=surface(d.width,d.height);
  sample.getContext('2d').drawImage(settings.sampleAll?d.composite():original,settings.sampleAll?0:layer.x,settings.sampleAll?0:layer.y);
  const task=new SelectionTask();let complete=false;const pending=showDialog('Magic Eraser',[{text:'Finding the color region… Cancel to keep the layer unchanged.'}],false);pending.then(()=>{if(!complete)task.cancel();});let result;
  try{result=await task.run(sample,new Uint8ClampedArray(0),'wand',{...settings,x,y,tolerance});}catch(error){if(error.name==='AbortError')return;throw error;}finally{complete=true;task.cancel();const dialog=document.querySelector('#dialog');if(dialog.open)dialog.close('done');await pending;}
  if(getDocument()!==d||d.active!==layer||d.revision!==revision||layer.canvas!==original||d.isLocked(layer)||d.isAlphaLocked(layer)!==locked)return;
  const next=copyCanvas(original),ctx=next.getContext('2d'),image=ctx.getImageData(0,0,next.width,next.height),bytes=image.data,color=[1,3,5].map(i=>parseInt(background.slice(i,i+2),16));if(locked&&color.some(v=>!Number.isFinite(v)))throw Error('Choose a valid background color.');let changed=false;
  for(let yy=0;yy<next.height;yy++)for(let xx=0;xx<next.width;xx++){
    const dx=Math.floor(xx+layer.x),dy=Math.floor(yy+layer.y);if(dx<0||dy<0||dx>=d.width||dy>=d.height)continue;const j=dy*d.width+dx,k=result.mask[j]/255*(opacity/100)*(selection?selection[j]/255:1);if(!(k>0))continue;const i=(yy*next.width+xx)*4;
    if(locked){for(let c=0;c<3;c++){const old=bytes[i+c];bytes[i+c]=old+(color[c]-old)*k;if(bytes[i+c]!==old)changed=true;}}
    else{const old=bytes[i+3];bytes[i+3]=old*(1-k);if(k>=1||old*(1-k)<=0){for(let c=0;c<4;c++){if(bytes[i+c])changed=true;bytes[i+c]=0;}}if(bytes[i+3]!==old)changed=true;}
  }
  if(!changed)return;ctx.putImageData(image,0,0);d.checkpoint('Magic Eraser');layer.canvas=next;d.changed();
}
