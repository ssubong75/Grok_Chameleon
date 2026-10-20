// PhotoCraft enable_rules.rs and menus.rs is_enabled, command ids used by this editor.
export function isBackground(layer){
  return Boolean(layer&&!layer.parentId&&!layer.kind&&!layer.clipping&&layer.lockAlpha&&layer.lockPosition);
}
function rasterKind(id,layer){
  if(!layer)return false;
  if(id==='layer.rasterize'||id==='layer.rasterize.type')return Boolean(layer.text);
  if(id==='layer.rasterize.shape')return Boolean(layer.shape);
  if(id==='layer.rasterize.fill')return Boolean(layer.kind==='smart'&&layer.fill);
  if(id==='layer.rasterizeSmart')return layer.kind==='smart';
  if(id==='layer.rasterize.layer')return Boolean(layer.text||layer.shape||layer.fill||layer.kind==='smart'||layer.vectorMask);
  return false;
}
const RASTER=['layer.rasterize','layer.rasterize.type','layer.rasterize.shape','layer.rasterize.fill','layer.rasterizeSmart','layer.rasterize.layer'];
function backgroundBlocks(id,hasSelection){
  if(id.startsWith('layer.vectorMask.')||id.startsWith('panel.style.'))return true;
  if(['layer.mask','layer.footerMask','layer.applyMask','layer.deleteMask','layer.linkMask','layer.toggleMask','layer.maskDensity'].includes(id))return true;
  if(['layer.bringToFront','layer.sendToBack','layer.reverse','layer.up','layer.down'].includes(id))return true;
  if(['layer.style','layer.scaleEffects','layer.blendingOptions','layer.pasteStyle','layer.clearStyle'].includes(id))return true;
  if(id==='edit.freeTransform'||id.startsWith('layer.transform.'))return !hasSelection;
  return ['layer.clipping','layer.merge','layer.lock'].includes(id);
}
const NO_DOCUMENT=new Set(['file.new','file.open','file.exit','file.newFromClipboard','edit.preferences','edit.menus','edit.keyboardShortcuts','edit.toolbar','edit.colorSettings','edit.presets.presetManager','edit.presets.migratePresets','edit.presets.exportImportPresets','edit.defineBrushPreset','chrome.about','chrome.resetWorkspace','view.rulers','view.grid','view.guides','view.snap','view.extras','view.show.all','view.snapTo.all','view.screenMode.standard','view.screenMode.fullScreenWithMenuBar','view.screenMode.fullScreen','view.screenMode.cycle']);
const NEEDS_SELECTION=new Set(['select.inverse','select.feather','select.expand','select.contract','select.border','select.smooth','select.grow','select.similar','select.transform','select.refine','select.selectAndMask','select.save','image.crop']);
function hasEffects(layer){return Boolean(layer?.effects&&Object.keys(layer.effects).length);}
function plainPixel(layer){return Boolean(layer&&!layer.kind&&!layer.parentId&&!layer.text&&!layer.shape);}
function hasBackground(layers){return layers.some(isBackground);}
function order(layers,selected){return selected.filter(layer=>layers.includes(layer)).sort((a,b)=>layers.indexOf(a)-layers.indexOf(b));}
function canClip(layer){return Boolean(layer&&!isBackground(layer)&&!layer.locked);}
function canTakeMask(layer){return Boolean(layer&&!isBackground(layer)&&!layer.locked&&!layer.mask&&!layer.shape);}
function transformExcused(id,doc){return (id==='edit.freeTransform'||id.startsWith('layer.transform.'))&&(doc.quickMask||doc.hasPath);}
export function menuBlocked(id,doc){
  if(!doc?.hasDocument){
    if(id==='file.openAs')return false;
    if(id.startsWith('window.')||id.startsWith('tool.')||id.startsWith('view.snapTo.')||id.startsWith('view.show.')||NO_DOCUMENT.has(id))return false;
    if(id==='edit.paste'&&doc?.clipboard)return false;
    return true;
  }
  const layers=doc.layers||[],active=doc.active||null,selected=doc.selected?.length?doc.selected:[active].filter(Boolean),ordered=order(layers,selected);
  const onlyBackground=layers.length===1&&isBackground(layers[0]);
  if(onlyBackground&&['layer.mergeVisible','layer.flatten','layer.merge'].includes(id))return true;
  if(id==='layer.mergeVisible'&&layers.filter(layer=>layer.visible!==false).length<2)return true;
  if(id==='layer.deleteHidden'&&layers.length&&layers.every(layer=>layer.visible!==false))return true;
  if(id==='layer.fromBackground')return !hasBackground(layers);
  if(id==='layer.background')return hasBackground(layers)||!plainPixel(active)||isBackground(active);
  if(NEEDS_SELECTION.has(id))return !doc.selection;
  if(id.startsWith('filter.'))return !active||Boolean(active.locked)||['group','adjustment'].includes(active.kind);
  if(id==='edit.freeTransform'&&!active&&!doc.quickMask&&!doc.hasPath)return true;
  if(id.startsWith('type.orientation.'))return !active?.text||Boolean(active.locked);
  if(id==='layer.hide'||id==='layer.lock')return !selected.length||selected.every(isBackground);
  if(['layer.bringToFront','layer.sendToBack','layer.reverse'].includes(id))return !selected.length||selected.every(layer=>isBackground(layer)||layer.locked||layer.lockPosition);
  if(RASTER.includes(id)&&selected.length>1)return !selected.some(layer=>rasterKind(id,layer)&&!layer.locked);
  if(['layer.copyStyle','layer.clearStyle'].includes(id)&&selected.length>1)return !selected.some(hasEffects);
  if(id==='layer.clipping'&&ordered.length>1)return !ordered.slice(1).some(canClip);
  if(id==='layer.mask'&&selected.length>1)return !selected.some(canTakeMask);
  if(isBackground(active)&&backgroundBlocks(id,Boolean(doc.selection))&&!transformExcused(id,doc))return true;
  if(['layer.copyStyle','layer.clearStyle'].includes(id))return !hasEffects(active);
  if(RASTER.includes(id))return !rasterKind(id,active)||Boolean(active?.locked);
  if(id==='edit.cut'||id==='edit.clear')return !active||Boolean(active.locked)||['group','adjustment','smart'].includes(active.kind);
  return false;
}
