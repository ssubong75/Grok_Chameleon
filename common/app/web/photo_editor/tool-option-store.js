const KEY='chameleon.photoEditor.toolOptions';
const FIELDS=['gradient','mixerSettings','colorReplacement','backgroundEraser','snap','snapTo','grid','guides','extras','layerEdges','showNotes','smartGuides','canvasGuides','artboardGuides','selectionEdges','targetPath','countsVisible','pixelGrid','showSlices','screenResolution','gridSize','cropRatio','cropClassic','cropShowCropped','cropOverlay','cropOverlayShow','cropShieldEnabled','cropShieldOpacity','cropShieldMode','cropShieldAuto','pencilAutoErase','eraserMode','eyedropperRing','eyedropperSample','eyedropperSize','selectionMode','zoomScrubby'];
export function packToolOptions(state){
  const out={version:1};
  for(const key of FIELDS)if(state[key]!==undefined)out[key]=state[key];
  return out;
}
export function readToolOptions(raw){
  let data=raw;
  if(typeof raw==='string'){try{data=JSON.parse(raw);}catch{return null;}}
  if(!data||data.version!==1)return null;
  const out={};
  for(const key of FIELDS)if(key in data)out[key]=data[key];
  if(out.snapTo)out.snapTo={guides:out.snapTo.guides!==false,grid:out.snapTo.grid!==false,layers:out.snapTo.layers!==false,slices:out.snapTo.slices!==false,document:out.snapTo.document!==false};
  if(out.screenResolution!=null){const n=Number(out.screenResolution);out.screenResolution=Number.isFinite(n)&&n>0?n:72;}
  if(out.gridSize!=null){const n=Number(out.gridSize);out.gridSize=Number.isFinite(n)&&n>=1&&n<=10000?n:32;}
  if('pencilAutoErase' in out)out.pencilAutoErase=Boolean(out.pencilAutoErase);
  if('eraserMode' in out)out.eraserMode=['brush','pencil','block'].includes(out.eraserMode)?out.eraserMode:'brush';
  if('eyedropperRing' in out)out.eyedropperRing=out.eyedropperRing!==false;
  if('eyedropperSample' in out&&!['current','currentAndBelow','all','currentAndBelowNoAdjustments','allNoAdjustments'].includes(out.eyedropperSample))delete out.eyedropperSample;
  if('eyedropperSize' in out){const n=Number(out.eyedropperSize);out.eyedropperSize=[1,3,5,11,31,51,101].includes(n)?n:1;}
  if('selectionMode' in out){const n=Number(out.selectionMode);out.selectionMode=[0,1,2,3].includes(n)?n:0;}
  if('zoomScrubby' in out)out.zoomScrubby=out.zoomScrubby!==false;
  return out;
}
export function applyToolOptions(state,stored){
  const data=readToolOptions(stored);
  if(!data)return false;
  Object.assign(state,data);
  return true;
}
export const toolOptionStorageKey=KEY;
