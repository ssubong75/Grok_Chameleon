// PhotoCraft view_cmds pixel_aspect_ratio and display_aspect. The document pixels stay square.
export const PIXEL_ASPECTS={square:1,d1DvNtsc:.91,d1DvPal:1.09,d1DvNtscWidescreen:1.21,hdv1080:1.33,d1DvPalWidescreen:1.46,dvcproHd1080:1.5,anamorphic2To1:2};
export function pixelAspectRatio(id){
  if(typeof id==='string'&&id.startsWith('custom:')){const ratio=Number(id.slice('custom:'.length).split(':')[0]);if(Number.isFinite(ratio))return ratio;}
  return Object.hasOwn(PIXEL_ASPECTS,id)?PIXEL_ASPECTS[id]:1;
}
export function displayAspect(id,correction){const ratio=pixelAspectRatio(id);return correction&&Number.isFinite(ratio)?Math.min(10,Math.max(.1,ratio)):1;}
export function customPixelAspect(list,payload,current='square'){
  const items=(list||[]).map(item=>({name:item.name,ratio:item.ratio}));
  if(payload?.delete!=null){const name=String(payload.delete),next=items.filter(item=>item.name!==name);if(next.length===items.length)throw Error(`no custom pixel aspect ratio "${name}"`);return {list:next,pixelAspect:String(current).endsWith(':'+name)?'square':current};}
  if(payload?.select!=null){const name=String(payload.select),found=items.find(item=>item.name===name);if(!found)throw Error(`no custom pixel aspect ratio "${name}"`);return {list:items,pixelAspect:`custom:${found.ratio}:${found.name}`};}
  const name=typeof payload?.name==='string'?payload.name.trim():'';
  if(!name)throw Error('pass `name`');
  const ratio=Number(payload?.ratio);
  if(!Number.isFinite(ratio))throw Error('pass `ratio`');
  if(ratio<.1||ratio>10)throw Error('the ratio must be between 0.100 and 10.000');
  const created={name,ratio},at=items.findIndex(item=>item.name===name);
  if(at>=0)items[at]=created;else items.push(created);
  return {list:items,pixelAspect:`custom:${ratio}:${name}`};
}
