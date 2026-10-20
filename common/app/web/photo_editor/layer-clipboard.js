import {EditorDocument,copyCanvas} from './engine.js';
import {translateSmartOperations,translateSmartRecord} from './transforms.js';
import {transformPath} from './paths.js';
function cloneLayer(layer){
  const result={...layer,canvas:copyCanvas(layer.canvas)};
  for(const key of ['mask','smartSource'])result[key]=layer[key]?copyCanvas(layer[key]):null;
  for(const key of ['fill','smartOrigin','smartOperations','shape','effects','adjustment','text','vectorMask','smartPsd','smartFeid'])result[key]=layer[key]?structuredClone(layer[key]):null;
  result.smartFile=layer.smartFile?new Uint8Array(layer.smartFile):null;
  result.smartImportQuad=Array.isArray(layer.smartImportQuad)?layer.smartImportQuad.slice():null;
  result.smartFilterMask=layer.smartFilterMask?{...layer.smartFilterMask,canvas:copyCanvas(layer.smartFilterMask.canvas)}:null;
  if(result.smartPsd)result.smartPsd.placed=crypto.randomUUID();
  return result;
}
function parentOffset(document,id){let x=0,y=0;const seen=new Set();while(id){if(seen.has(id))throw Error('A layer group contains a circular reference.');seen.add(id);const parent=document.layers.find(layer=>layer.id===id);if(!parent)break;x+=parent.x||0;y+=parent.y||0;id=parent.parentId;}return{x,y};}
function shift(layer,dx,dy){layer.x+=dx;layer.y+=dy;if(layer.vectorMask?.path&&layer.vectorMask.linked!==false)transformPath(layer.vectorMask.path,(x,y)=>({x:x+dx,y:y+dy}));if(layer.kind==='smart'&&layer.smartOrigin){layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);translateSmartRecord(layer,dx,dy,true);}}
export function copyLayerClipboard(document,cut=false){
  if(document.selection||document.channelTarget||document.paintLayer?.editMask)return null;
  const roots=document.selectedRoots();if(!roots.length||roots.length===1&&!['group','smart'].includes(roots[0].kind)&&!roots[0].text&&!roots[0].shape)return null;
  const ids=new Set();for(const root of roots)for(const id of document.descendants(root.id))ids.add(id);
  if(cut&&document.layers.some(layer=>ids.has(layer.id)&&document.isLocked(layer)))throw Error('Unlock the selected layers before cutting.');
  const layers=document.layers.filter(layer=>ids.has(layer.id)).map(cloneLayer),rootIds=roots.map(root=>root.id);
  for(const root of layers.filter(layer=>rootIds.includes(layer.id))){const offset=parentOffset(document,root.parentId);shift(root,offset.x,offset.y);root.parentId=null;}
  const scratch=new EditorDocument(document.width,document.height,'');scratch.layers=layers;
  return{layers,rootIds,preview:scratch.composite(),width:document.width,height:document.height};
}
export function pasteLayerClipboard(document,clipboard,placement,origin={x:0,y:0},record=true){
  const parentId=document.active?.kind==='group'?document.active.id:document.active?.parentId||null;
  if(parentId&&document.isLocked(document.layers.find(layer=>layer.id===parentId)))throw Error('Unlock the destination group before pasting.');
  const layers=clipboard.layers.map(cloneLayer),ids=new Map(layers.map(layer=>[layer.id,crypto.randomUUID()])),offset=parentOffset(document,parentId),dx=placement.x-origin.x-offset.x,dy=placement.y-origin.y-offset.y;
  for(const layer of layers){const old=layer.id,isRoot=clipboard.rootIds.includes(old);layer.id=ids.get(old);layer.parentId=isRoot?parentId:ids.get(layer.parentId)||null;if(isRoot)shift(layer,dx,dy);layer.editMask=false;}
  if(record)document.checkpoint('Paste Layers');
  // Flat layer storage preserves source ordering; hierarchy follows remapped parent IDs.
  const anchor=document.active,index=anchor?document.layers.indexOf(anchor)+1:document.layers.length;document.layers.splice(index,0,...layers);document.selectedLayerIds=clipboard.rootIds.map(id=>ids.get(id));document.activeId=document.selectedLayerIds.at(-1)||null;document.selection=null;document.changed();
  return layers;
}
