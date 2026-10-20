import {historyLogRecord,currentHistoryCommand} from './history-log.js';
import {applyCanvasInterpolation} from './interpolation-preferences.js';
import {historyOverLimit} from './history-policy.js';
import {smartLinkRecord} from './smart-link.js';
import {timelineCreate,timelineFrame,timelineStep} from './timeline.js';
import {artboardRecord} from './artboard.js';
import {placeCoverage} from './type-mask.js';
import {convexQuad,mapAffine,nearestAffine,outputSize,quadToRect,warpImage} from './perspective-crop.js';
import {moveNote,newNote,noteColor,noteRecord} from './notes.js';
import {divideRect,guideSliceRects,resolveSlices,sliceRecord} from './slices.js';
import {cropCoverage,cropCovered,cropPieces,plainCropCoverage,rotatedCropRect,rotatedSize} from './crop-frame.js';
import {contentAwareImage} from './content-aware.js';
import {ellipseMask,frameMaskRect,frameTakes} from './frame.js';
import {countRecord} from './count-record.js';
import {rulerRecord} from './ruler-record.js';
import {captureCompStates,validateLayerComps,prepareComp,compMatches,cycleCompId,updateCompStates,planCompPositions} from './layer-comps.js';
import {compositeTextGamma,getTextGamma} from './text-gamma.js';
import {renderShape} from './shape-renderer.js';
import {unfilteredRGBRecord} from './psd-smart.js';
import {combineFilterMask} from './smart-filter-mask.js';
import {featherPlane} from './mask-feather.js';
import {validateProfile} from './psd-profile.js';
import {rebaseFillHistory} from './fill-history.js';
import {renderFill} from './fill-renderer.js';
import {resamplePixels} from './resample.js';
import {packSelection,unpackSelection} from './project-selection.js';
// Photo Editor document engine. Browser Canvas only; no Rust, WASM or build step.
import {adjustPixels} from './filters.js';
import {tracePath,transformPath,pathBounds,selectionPaths,pathContours} from './paths.js';
import {layerMatrix,transformedBounds,translateSmartOperations,translateSmartRecord,multiplyAffine,affinePoint,inverseAffine} from './transforms.js';
import {typeMatrix,redrawTypeLayer} from './text-layout.js';
import {colorSelection,selectionFromPixels,traceSelectionRuns,combineSelections,offsetSelection,alphaSelection,selectionWeight} from './selections.js';
import {renderEffects} from './layer-effects.js';
import {applyBlendIf,restoreChannels,blendIfActive,channelWeights} from './blend-if.js';
import {knockoutBackdrop,knockoutOpacity,clipInside} from './knockout.js';
import {colorLuminance} from './brush-engine.js';
import {perspectivePixels,quadMapping} from './perspective.js';
import {vectorCoverage,vectorMaskRecord} from './vector-mask.js';
import {captureRecord} from './jpeg-exif.js';
import {warpPlacePixels} from './warp-place.js';
import {customBlends,compositeCustom} from './blend-modes.js';
import {modifyCoverage} from './selection-morphology.js';
import {transformedShape} from './shape-path.js';
export function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}
export function copyCanvas(source) {
  const canvas = surface(source.width, source.height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}
function mixImage(before,after,coverage){const out=new Uint8ClampedArray(before.data);for(let i=0;i<out.length;i+=4){const k=coverage?coverage[i+3]/255:1,wa=before.data[i+3]/255*(1-k),wb=after.data[i+3]/255*k,alpha=wa+wb;for(let c=0;c<3;c++)out[i+c]=alpha?(before.data[i+c]*wa+after.data[i+c]*wb)/alpha:0;out[i+3]=alpha*255;}return new ImageData(out,before.width,before.height);}
function addPremultipliedDelta(base,withData,withoutData){const out=new Uint8ClampedArray(base.data);for(let i=0;i<out.length;i+=4){const pa=out[i+3]/255,pm=[out[i]/255*pa,out[i+1]/255*pa,out[i+2]/255*pa,pa],wa=withData.data[i+3]/255,wo=withoutData.data[i+3]/255;for(let c=0;c<3;c++)pm[c]+=withData.data[i+c]/255*wa-withoutData.data[i+c]/255*wo;pm[3]+=wa-wo;const alpha=Math.max(0,Math.min(1,pm[3]));if(alpha>0){for(let c=0;c<3;c++)out[i+c]=Math.max(0,Math.min(255,pm[c]/alpha*255));out[i+3]=alpha*255;}else out[i]=out[i+1]=out[i+2]=out[i+3]=0;}return new ImageData(out,base.width,base.height);}
function bytesToBase64(bytes){let text='';for(let index=0;index<bytes.length;index+=0x8000)text+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(text);}
function base64ToBytes(value){const text=atob(value),bytes=new Uint8Array(text.length);for(let index=0;index<text.length;index++)bytes[index]=text.charCodeAt(index);return bytes;}
function pathNumbers(path){return pathContours(path).flatMap(contour=>[contour.closed?1:0,...(contour.nodes||[]).flatMap(node=>[node.x,node.y,node.inX??node.x,node.inY??node.y,node.outX??node.x,node.outY??node.y])]);}
function sameTextPath(a,b){const left=pathNumbers(a),right=pathNumbers(b);return left.length===right.length&&left.every((value,index)=>Math.abs((value||0)-(right[index]||0))<1e-3);}
export class EditorDocument extends EventTarget {
  constructor(width, height, name = 'Untitled') {
    super();if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('Document dimensions must fit within 32,767 pixels per side and 64 million pixels.'); this.width = width; this.height = height; this.name = name;this.resolution=72;this.iccProfile=null;this.duotoneRaw=null;this.colorTable=null;this.psdMode=null;
    this.countGroups=[];this.activeCountGroup=null;this.ruler=null;this.layerComps=[];this.appliedComp=null;this.lastCompState=null;this.documentId=crypto.randomUUID();
    this.layers = []; this.activeId = null;this.selectedLayerIds=[];this.selection = null;
    this.paths=[];this.activePathId=null;this.guides=[];this.notes=[];this.slices=[];this.channels=[];this.quickMask=null;this.activeChannelId='RGB';
    this.undoStack = []; this.redoStack = []; this.historyBytes = 0;
    this.dirty = false; this.revision = 0; this.timeline=null;
  }
  newLayerComp(name,visibility=true,appearance=true,position=false){if(this.layerComps.length>=100)throw Error('The document already has 100 layer comps.');const comp={id:crypto.randomUUID(),name:String(name).trim().slice(0,200),visibility:Boolean(visibility),appearance:Boolean(appearance),position:Boolean(position),states:captureCompStates(this.layers)};if(!comp.name||!comp.visibility&&!comp.appearance&&!comp.position)throw Error('Name the comp and choose at least one capture option.');this.checkpoint('New Layer Comp');this.layerComps.push(comp);this.changed();}
  prepareCompPosition(layer,dx,dy){
    const next={...layer,vectorMask:layer.vectorMask?structuredClone(layer.vectorMask):null,smartFilterMask:layer.smartFilterMask?structuredClone(layer.smartFilterMask):null,smartOrigin:layer.smartOrigin?{...layer.smartOrigin}:null,smartOperations:layer.smartOperations?structuredClone(layer.smartOperations):undefined,smartPsd:layer.smartPsd?structuredClone(layer.smartPsd):undefined,smartImportQuad:layer.smartImportQuad?structuredClone(layer.smartImportQuad):undefined,smartFeid:layer.smartFeid?structuredClone(layer.smartFeid):undefined};
    this.positionLayer(next,layer.x+dx,layer.y+dy,true);
    return Object.fromEntries(['x','y','maskOffsetX','maskOffsetY','vectorMask','smartFilterMask','smartOrigin','smartOperations','smartPsd','smartImportQuad','smartFeid'].filter(key=>next[key]!==undefined).map(key=>[key,next[key]]));
  }
  prepareLayerComp(comp,current=captureCompStates(this.layers)){
    const positions=planCompPositions(this.layers,comp,current,(...args)=>this.prepareCompPosition(...args),(layer,dx,dy)=>{
      const patch={};if(layer.artboard)patch.artboard={...layer.artboard,x:layer.artboard.x+dx,y:layer.artboard.y+dy};
      if(layer.mask&&layer.maskLinked!==false){patch.maskOffsetX=(layer.maskOffsetX||0)+dx;patch.maskOffsetY=(layer.maskOffsetY||0)+dy;}
      if(layer.vectorMask?.path&&layer.vectorMask.linked!==false){patch.vectorMask=structuredClone(layer.vectorMask);transformPath(patch.vectorMask.path,(x,y)=>({x:x+dx,y:y+dy}));}return patch;
    }),appearance=prepareComp(this.layers,{...comp,position:false});
    const byId=new Map(positions.map(p=>[p.layer.id,p]));for(const entry of appearance){if(byId.has(entry.layer.id))Object.assign(byId.get(entry.layer.id).patch,entry.patch);else byId.set(entry.layer.id,entry);}return[...byId.values()];
  }
  editLayerComp(id,action,settings={}){if(action==='previous'||action==='next')return this.editLayerComp(cycleCompId(this.layerComps,this.appliedComp,action==='next'?1:-1),'apply');if(action==='restore'){if(!this.lastCompState)throw Error('No previous layer comp state is available.');const prepared=this.prepareLayerComp(this.lastCompState);this.checkpoint('Restore Last Layer Comp State');for(const {layer,patch}of prepared)Object.assign(layer,patch);this.appliedComp=null;this.changed();return;}const comp=this.layerComps.find(c=>c.id===id);if(!comp)throw Error('The layer comp is no longer available.');if(action==='apply'){const states=captureCompStates(this.layers),prepared=this.prepareLayerComp(comp,states),previous=this.layerComps.find(c=>c.id===this.appliedComp),backup=!compMatches(states,previous);this.checkpoint('Apply Layer Comp');if(backup)this.lastCompState={id:'last-state',name:'Last State',visibility:true,appearance:true,position:true,states};for(const {layer,patch}of prepared)Object.assign(layer,patch);this.appliedComp=comp.id;}else if(action==='update'){const states=updateCompStates(comp.states,captureCompStates(this.layers),settings.what||'all');this.checkpoint('Update Layer Comp');comp.states=states;}else if(action==='options'){const patch={name:settings.name,comment:settings.comment,visibility:settings.visibility,position:settings.position,appearance:settings.appearance},prepared=validateLayerComps([{...comp,...patch}])[0];this.checkpoint('Layer Comp Options');Object.assign(comp,prepared);}else if(action==='duplicate'){if(this.layerComps.length>=100)throw Error('The document already has 100 layer comps.');const copy={...structuredClone(comp),id:crypto.randomUUID(),name:(comp.name+' copy').slice(0,200)};this.checkpoint('Duplicate Layer Comp');this.layerComps.splice(this.layerComps.indexOf(comp)+1,0,copy);}else if(action==='delete'){this.checkpoint('Delete Layer Comp');this.layerComps=this.layerComps.filter(c=>c!==comp);if(this.appliedComp===id)this.appliedComp=null;}else throw Error('Unknown layer comp action.');this.changed();}
  get active() { return this.layers.find(layer => layer.id === this.activeId); }
  get selectedLayers(){const selected=this.layers.filter(layer=>this.selectedLayerIds.includes(layer.id));return selected.length?selected:this.active?[this.active]:[];}
  get channelTarget(){return this.quickMask||this.channels.find(channel=>channel.id===this.activeChannelId);}
  get paintLayer(){if(this._smartReplayLayerId===this.activeId)return this.active;const channel=this.channelTarget;if(!channel)return this.active;return{id:channel.id,name:channel.name,x:0,y:0,kind:'channel',editMask:true,locked:false,get canvas(){return channel.canvas;},set canvas(value){channel.canvas=value;},get mask(){return channel.canvas;},set mask(value){channel.canvas=value;}};}
  maskOrigin(layer=this.active){return{x:(layer?.x||0)+(layer?.maskOffsetX||0),y:(layer?.y||0)+(layer?.maskOffsetY||0)};}
  alignedMask(layer=this.active){if(!layer?.mask)return null;const output=surface(layer.canvas.width,layer.canvas.height);output.getContext('2d').drawImage(layer.mask,layer.maskOffsetX||0,layer.maskOffsetY||0);return output;}
  usesCoverage(layer){return Boolean(layer&&(layer.mask&&!layer.maskDisabled||layer.vectorMask&&layer.vectorMask.enabled!==false&&layer.vectorMask.path));}
  coverageMask(layer,width,height,x=0,y=0){
    const output=surface(width,height),ctx=output.getContext('2d');
    if(layer.mask&&!layer.maskDisabled){
      const density=Math.max(0,Math.min(1,layer.maskDensity??1)),origin=this.maskOrigin(layer);
      const feather=featherPlane(layer.mask,layer.maskFeather,layer.maskDefault===255?1:0,this.revision);
      if(feather){const image=ctx.createImageData(width,height);for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){const sx=xx+x-origin.x+feather.padding,sy=yy+y-origin.y+feather.padding,ix=Math.floor(sx),iy=Math.floor(sy),read=(px,py)=>px>=0&&py>=0&&px<feather.width&&py<feather.height?feather.values[py*feather.width+px]:feather.defaultValue,fx=sx-ix,fy=sy-iy,value=read(ix,iy)*(1-fx)*(1-fy)+read(ix+1,iy)*fx*(1-fy)+read(ix,iy+1)*(1-fx)*fy+read(ix+1,iy+1)*fx*fy,i=(yy*width+xx)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=(1-density*(1-value))*255;}ctx.putImageData(image,0,0);}
      else{if(layer.maskDefault===255){ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.clearRect(origin.x-x,origin.y-y,layer.mask.width,layer.mask.height);}ctx.drawImage(layer.mask,origin.x-x,origin.y-y);if(density<1){ctx.globalCompositeOperation='destination-over';ctx.globalAlpha=1-density;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';}}
    }else{ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);}
    const vector=vectorCoverage(layer.vectorMask,width,height,x,y,this.revision);if(!vector)return output;
    const base=ctx.getImageData(0,0,width,height),extra=vector.getContext('2d').getImageData(0,0,width,height);for(let i=3;i<base.data.length;i+=4)base.data[i]=Math.round(base.data[i]*extra.data[i]/255);ctx.putImageData(base,0,0);return output;
  }

  isLocked(layer=this.active){if(layer?.id===this._smartReplayLayerId)return false;const visited=new Set();while(layer){if(layer.locked||visited.has(layer.id))return true;visited.add(layer.id);layer=this.layers.find(parent=>parent.id===layer.parentId);}return false;}
  hasLock(layer,key){if(layer?.id===this._smartReplayLayerId)return false;const visited=new Set();while(layer&&!visited.has(layer.id)){if(layer[key])return true;visited.add(layer.id);layer=this.layers.find(parent=>parent.id===layer.parentId);}return false;}
  isAlphaLocked(layer=this.active){return this.hasLock(layer,'lockAlpha');}
  isPositionLocked(layer=this.active){return this.isLocked(layer)||this.hasLock(layer,'lockPosition');}
  changed() { if(this._smartReplayLayerId||this._smartBatchUpdate)return;this.dirty = true; this.revision++; this.refreshTextPaths(); this.dispatchEvent(new Event('change')); }
  refreshTextPaths(){
    if(this._refreshingText)return;
    this._refreshingText=true;
    try{
      for(const layer of this.layers){
        const text=layer.text;if(!text?.pathId)continue;
        const source=this.paths.find(path=>path.id===text.pathId);
        if(!source||(source.nodes?.length||0)<2)continue;
        let inverse;try{inverse=inverseAffine(typeMatrix(text));}catch{continue;}
        const local=transformPath(structuredClone(source),(x,y)=>affinePoint(inverse,x-layer.x,y-layer.y));
        if(sameTextPath(text.path,local))continue;
        redrawTypeLayer(layer,{...text,path:local});
      }
    }finally{this._refreshingText=false;}
  }
  snapshot(source=this) {
    return {countGroups:countRecord(source.countGroups),activeCountGroup:source.activeCountGroup||null,ruler:rulerRecord(source.ruler),layerComps:structuredClone(source.layerComps||[]),appliedComp:source.appliedComp||null,lastCompState:source.lastCompState?structuredClone(source.lastCompState):null,width: source.width, height: source.height,resolution:source.resolution,psdMode:source.psdMode||null,capture:source.capture?{...source.capture}:null,iccProfile:source.iccProfile?new Uint8Array(source.iccProfile):null,duotoneRaw:source.duotoneRaw?new Uint8Array(source.duotoneRaw):null,colorTable:source.colorTable?new Uint8Array(source.colorTable):null, activeId: source.activeId,selectedLayerIds:[...(source.selectedLayerIds||[])],
      paths:structuredClone(source.paths),activePathId:source.activePathId,guides:structuredClone(source.guides),notes:structuredClone(source.notes||[]),slices:structuredClone(source.slices||[]),activeChannelId:source.activeChannelId,quickMask:source.quickMask?{...source.quickMask,canvas:copyCanvas(source.quickMask.canvas)}:null,channels:source.channels.map(channel=>({...channel,canvas:copyCanvas(channel.canvas)})),
      selection: source.selection ? structuredClone(source.selection) : null,previousSelection:source.previousSelection?structuredClone(source.previousSelection):null,
      layers: source.layers.map(layer => ({...layer,smartLink:layer.smartLink?{...layer.smartLink}:null,fill:layer.fill?structuredClone(layer.fill):null,smartOrigin:layer.smartOrigin?structuredClone(layer.smartOrigin):null,smartPsd:layer.smartPsd?structuredClone(layer.smartPsd):null,smartFile:layer.smartFile?new Uint8Array(layer.smartFile):null,smartFeid:layer.smartFeid?structuredClone(layer.smartFeid):null,smartImportQuad:layer.smartImportQuad?layer.smartImportQuad.slice():null,smartFilterMask:layer.smartFilterMask?{...layer.smartFilterMask,canvas:copyCanvas(layer.smartFilterMask.canvas)}:null,smartSource:layer.smartSource?copyCanvas(layer.smartSource):null,smartOperations:layer.smartOperations?structuredClone(layer.smartOperations):null,shape:layer.shape?structuredClone(layer.shape):null,vectorMask:layer.vectorMask?structuredClone(layer.vectorMask):null,effects:layer.effects?structuredClone(layer.effects):null,adjustment:layer.adjustment?structuredClone(layer.adjustment):null,text: layer.text ? structuredClone(layer.text) : null, mask: layer.mask ? copyCanvas(layer.mask) : null, canvas: copyCanvas(layer.canvas)}))};
  }
  restore(state) {
    this.countGroups=countRecord(state.countGroups);this.activeCountGroup=this.countGroups.some(g=>g.id===state.activeCountGroup)?state.activeCountGroup:this.countGroups[0]?.id||null;
    this.ruler=rulerRecord(state.ruler);
    this.layerComps=structuredClone(state.layerComps||[]);this.appliedComp=state.appliedComp||null;this.lastCompState=state.lastCompState?structuredClone(state.lastCompState):null;
    this.width = state.width; this.height = state.height;this.resolution=state.resolution||72;this.psdMode=state.psdMode||null;this.capture=state.capture||null;this.iccProfile=state.iccProfile?new Uint8Array(state.iccProfile):null;this.duotoneRaw=state.duotoneRaw?new Uint8Array(state.duotoneRaw):null;this.colorTable=state.colorTable?new Uint8Array(state.colorTable):null; this.activeId = state.activeId;this.selectedLayerIds=state.selectedLayerIds||[];
    this.selection = state.selection;this.previousSelection=state.previousSelection||null; this.layers = state.layers;
    this.paths=state.paths||[];this.activePathId=state.activePathId||null;this.guides=state.guides||[];this.notes=noteRecord(state.notes)||[];this.slices=sliceRecord(state.slices)||[];this.channels=state.channels||[];this.quickMask=state.quickMask||null;this.activeChannelId=state.activeChannelId||'RGB';
    this.changed();
  }
  checkpoint(label) {
    const state = this.snapshot();
    const bytes = state.layers.reduce((n, layer) => n + (layer.canvas.width * layer.canvas.height+(layer.smartSource?layer.smartSource.width*layer.smartSource.height:0)+(layer.mask?layer.mask.width*layer.mask.height:0)+(layer.smartFilterMask?layer.smartFilterMask.canvas.width*layer.smartFilterMask.canvas.height:0)) * 4+(layer.smartFile?.byteLength||0), 0)+state.channels.reduce((n,channel)=>n+channel.canvas.width*channel.canvas.height*4,0)+(state.quickMask?state.quickMask.canvas.width*state.quickMask.canvas.height*4:0)+(state.selection?.pixels?.byteLength||0)+(state.previousSelection?.pixels?.byteLength||0)+state.layers.reduce((n,layer)=>n+(layer.smartDocument?.length||0)*2,0)+(state.iccProfile?.byteLength||0)+(state.duotoneRaw?.byteLength||0)+(state.colorTable?.byteLength||0);
    this.undoStack.push({label, state, bytes, command:currentHistoryCommand()}); this.historyBytes += bytes; this.redoStack = [];
    const command=this.undoStack.at(-1).command||'';
    if((command.startsWith('filter.')||command.startsWith('image.adjustments.')||command.startsWith('paint.')||['edit.fill','edit.stroke','edit.contentAwareFill','image.autoTone','image.autoContrast','image.autoColor'].includes(command))&&this.active?.canvas){
      const mask=Boolean(this.active.editMask&&this.active.mask);
      this.fade={layerId:this.active.id,label,mask,before:copyCanvas(mask?this.active.mask:this.active.canvas),revision:this.undoStack.length};
    }
    this.trimHistory();
  }
  trimHistory(){while(historyOverLimit(this.undoStack.length,this.historyBytes))this.historyBytes-=this.undoStack.shift().bytes;}
  undo() {
    const previous = this.undoStack.pop(); if (!previous) return;
    this.historyBytes -= previous.bytes;
    this.redoStack.push({label: previous.label, state: this.snapshot(), bytes: previous.bytes, command: previous.command||null});
    this.restore(previous.state);
  }
  redo() {
    const next = this.redoStack.pop(); if (!next) return;
    this.undoStack.push({label: next.label, state: this.snapshot(), bytes: next.bytes, command: next.command||null});
    this.historyBytes += next.bytes; this.trimHistory();this.restore(next.state);
  }
  addLayer(name = 'Layer', source = null, record = true) {
    if (record) this.checkpoint('New Layer');
    const layer = {id: crypto.randomUUID(), name, visible: true, locked: false,
      opacity: 1, blend: 'source-over', x: 0, y: 0,
      parentId:this.active?.kind==='group'?this.active.id:this.active?.parentId||null,
      canvas: source ? copyCanvas(source) : surface(this.width, this.height)};
    this.layers.push(layer); this.activeId = layer.id;this.selectedLayerIds=[layer.id]; this.changed(); return layer;
  }
  selectedRoots(){const ids=new Set(this.selectedLayers.map(layer=>layer.id));return this.selectedLayers.filter(layer=>{let parent=layer.parentId;while(parent){if(ids.has(parent))return false;parent=this.layers.find(item=>item.id===parent)?.parentId;}return true;});}
  duplicate(independentSmart=false) {
    const originals=independentSmart?(this.active?.kind==='smart'?[this.active]:[]):this.selectedRoots();if(!originals.length)return;this.checkpoint(independentSmart?'New Smart Object via Copy':'Duplicate Layers');const created=[];
    const clone=(original,parentId=original.parentId)=>{if(original.kind==='smart'&&!original.smartContentsId)original.smartContentsId=original.smartPsd?.id||crypto.randomUUID();const layer={...original,id:crypto.randomUUID(),parentId,name:original.name+' copy',smartOrigin:original.smartOrigin?structuredClone(original.smartOrigin):null,smartPsd:original.smartPsd?structuredClone(original.smartPsd):null,smartFile:original.smartFile?new Uint8Array(original.smartFile):null,smartFeid:original.smartFeid?structuredClone(original.smartFeid):null,smartImportQuad:original.smartImportQuad?original.smartImportQuad.slice():null,smartFilterMask:original.smartFilterMask?{...original.smartFilterMask,canvas:copyCanvas(original.smartFilterMask.canvas)}:null,fill:original.fill?structuredClone(original.fill):null,adjustment:original.adjustment?structuredClone(original.adjustment):null,canvas:copyCanvas(original.canvas),mask:original.mask?copyCanvas(original.mask):null,smartSource:original.smartSource?copyCanvas(original.smartSource):null,smartOperations:original.smartOperations?structuredClone(original.smartOperations):null,text:original.text?structuredClone(original.text):null,shape:original.shape?structuredClone(original.shape):null,vectorMask:original.vectorMask?structuredClone(original.vectorMask):null,effects:original.effects?structuredClone(original.effects):null};if(layer.smartPsd)layer.smartPsd.placed=crypto.randomUUID();if(independentSmart&&layer.kind==='smart'){layer.smartContentsId=crypto.randomUUID();if(layer.smartPsd)layer.smartPsd.id=layer.smartContentsId;}this.layers.splice(this.layers.indexOf(original)+1,0,layer);if(original.kind==='group')for(const child of this.layers.filter(item=>item.parentId===original.id))clone(child,layer.id);return layer;};
    for(const original of originals)created.push(clone(original));this.selectedLayerIds=created.map(layer=>layer.id);this.activeId=created.at(-1).id;this.changed();
  }
  createEmptyGroup(name='Group'){
    const parentId=this.active?.parentId||null,parent=this.layers.find(l=>l.id===parentId);if(parent&&this.isLocked(parent))throw Error('Unlock the parent group before inserting a group.');
    const group={id:crypto.randomUUID(),name:String(name).trim().slice(0,200)||'Group',kind:'group',visible:true,locked:false,opacity:1,blend:'source-over',passThrough:true,collapsed:false,x:0,y:0,parentId,canvas:surface(this.width,this.height)},index=this.active?this.layers.indexOf(this.active)+1:this.layers.length;
    this.checkpoint('New Group');this.layers.splice(index,0,group);this.activeId=group.id;this.selectedLayerIds=[group.id];this.changed();return group;
  }
  addArtboard(rect){
    const board=artboardRecord({x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h),background:'white'});
    if(!board)throw Error('Artboard is empty.');
    const names=this.layers.filter(layer=>layer.artboard).map(layer=>layer.name);let n=1;while(names.includes('Artboard '+n))n++;
    this.checkpoint('New Artboard');
    const layer={id:crypto.randomUUID(),name:'Artboard '+n,kind:'group',visible:true,locked:false,opacity:1,blend:'source-over',passThrough:false,collapsed:false,clipping:false,x:0,y:0,parentId:null,canvas:surface(1,1),artboard:board};
    this.layers.push(layer);this.activeId=layer.id;this.selectedLayerIds=[layer.id];this.fitArtboards();this.changed();return layer;
  }
  moveArtboard(layer,x,y){
    if(!layer?.artboard)throw Error('Select an artboard.');
    const dx=Math.round(x)-layer.artboard.x,dy=Math.round(y)-layer.artboard.y;if(!dx&&!dy)return;
    this.checkpoint('Move Artboard');layer.artboard={...layer.artboard,x:layer.artboard.x+dx,y:layer.artboard.y+dy};
    const ids=this.descendants(layer.id);
    for(const item of this.layers)if(ids.has(item.id)&&item.kind==='group'&&item.mask&&item.maskLinked!==false){item.maskOffsetX=(item.maskOffsetX||0)+dx;item.maskOffsetY=(item.maskOffsetY||0)+dy;}
    for(const item of this.layers)if(ids.has(item.id)&&item!==layer&&item.kind!=='group')this.positionLayer(item,item.x+dx,item.y+dy);
    this.fitArtboards();this.changed();
  }
  resizeArtboard(layer,rect){
    if(!layer?.artboard)throw Error('Select an artboard.');
    const board=artboardRecord({...layer.artboard,x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)});
    if(!board)throw Error('Artboard is empty.');
    this.checkpoint('Resize Artboard');layer.artboard=board;this.fitArtboards();this.changed();
  }
  fitArtboards(){
    let left=0,top=0,right=this.width,bottom=this.height;
    for(const layer of this.layers){const board=layer.artboard;if(!board)continue;left=Math.min(left,board.x);top=Math.min(top,board.y);right=Math.max(right,board.x+board.w);bottom=Math.max(bottom,board.y+board.h);}
    const dx=left<0?-left:0,dy=top<0?-top:0;
    if(dx||dy){
      for(const layer of this.layers){if(layer.artboard)layer.artboard={...layer.artboard,x:layer.artboard.x+dx,y:layer.artboard.y+dy};if(layer.kind==='group'){if(layer.mask&&layer.maskLinked!==false){layer.maskOffsetX=(layer.maskOffsetX||0)+dx;layer.maskOffsetY=(layer.maskOffsetY||0)+dy;}}else this.positionLayer(layer,layer.x+dx,layer.y+dy);}
      this.guides=this.guides.map(guide=>({...guide,position:guide.position+(guide.axis==='vertical'?dx:dy)}));this.paths.forEach(path=>transformPath(path,(x,y)=>({x:x+dx,y:y+dy})));right+=dx;bottom+=dy;
    }
    const width=Math.ceil(right),height=Math.ceil(bottom);
    if(width>32767||height>32767||width*height>64000000)throw Error('Artboard exceeds the image size limit.');
    if(width===this.width&&height===this.height)return;
    for(const channel of [...this.channels,...(this.quickMask?[this.quickMask]:[])]){const next=surface(width,height);next.getContext('2d').drawImage(channel.canvas,dx,dy);channel.canvas=next;}
    this.width=width;this.height=height;
  }
  paintArtboard(ctx,layer){
    const board=layer.artboard;if(!board)return;ctx.save();
    if(board.background!=='transparent'){ctx.globalCompositeOperation='destination-over';ctx.fillStyle=board.background==='black'?'#000000':'#ffffff';ctx.fillRect(board.x,board.y,board.w,board.h);}
    ctx.globalCompositeOperation='destination-in';ctx.fillStyle='#ffffff';ctx.fillRect(board.x,board.y,board.w,board.h);ctx.restore();
  }
  createGroup(name='Group'){
    const selected=this.selectedRoots(),parentId=selected[0]?.parentId||null;if(!selected.length)throw Error('Select layers to group.');const affected=new Set();for(const root of selected)for(const id of this.descendants(root.id))affected.add(id);for(const layer of this.layers.filter(l=>affected.has(l.id))){let depth=1,parent=layer.parentId;const seen=new Set([layer.id]);while(parent){if(seen.has(parent)||++depth>=30)throw Error('Grouping would exceed the supported layer depth.');seen.add(parent);parent=this.layers.find(l=>l.id===parent)?.parentId;}}if(selected.some(layer=>(layer.parentId||null)!==parentId))throw Error('Select layers from the same group to group them.');if(selected.some(layer=>this.isLocked(layer)))throw Error('Unlock the selected layers before grouping.');const group={id:crypto.randomUUID(),name:String(name).trim().slice(0,200)||'Group',kind:'group',passThrough:true,parentId,collapsed:false,visible:true,locked:false,opacity:1,blend:'source-over',x:0,y:0,canvas:surface(this.width,this.height)};this.checkpoint('Group Layers');
    this.layers.splice(Math.max(...selected.map(layer=>this.layers.indexOf(layer)))+1,0,group);for(const layer of selected)layer.parentId=group.id;this.activeId=group.id;this.selectedLayerIds=[group.id];this.changed();return group;
  }
  ungroup(){const group=this.active;if(group?.kind!=='group'||this.isLocked(group))return;this.checkpoint('Ungroup Layers');for(const layer of this.layers)if(layer.parentId===group.id)layer.parentId=group.parentId||null;const index=this.layers.indexOf(group);this.layers.splice(index,1);this.activeId=this.layers[Math.max(0,index-1)]?.id||null;this.selectedLayerIds=this.activeId?[this.activeId]:[];this.changed();}
  mergeGroup(){const group=this.active;if(group?.kind!=='group'||this.isLocked(group))return;this.checkpoint('Merge Group');const pixels=this.composite(group.id),ids=this.descendants(group.id);this.layers=this.layers.filter(layer=>layer===group||!ids.has(layer.id));group.canvas=pixels;group.kind=null;group.collapsed=false;this.selectedLayerIds=[group.id];this.changed();}
  descendants(id){const result=new Set([id]);let added=true;while(added){added=false;for(const layer of this.layers)if(layer.parentId&&result.has(layer.parentId)&&!result.has(layer.id)){result.add(layer.id);added=true;}}return result;}
  moveLayer(id,targetId,position='above'){
    if(this.selectedRoots().length>1&&this.selectedLayerIds.includes(id)){this.moveLayers(targetId,position);return;}
    const layer=this.layers.find(item=>item.id===id),target=this.layers.find(item=>item.id===targetId);if(!layer||!target||layer===target||this.isLocked(layer))return;
    const parentId=position==='inside'&&target.kind==='group'?target.id:target.parentId||null;if(parentId&&this.descendants(id).has(parentId))throw Error('A group cannot be moved into itself.');if(parentId&&this.isLocked(this.layers.find(item=>item.id===parentId)))throw Error('The destination group is locked.');
    this.checkpoint('Move Layer');this.layers.splice(this.layers.indexOf(layer),1);layer.parentId=parentId;const index=this.layers.indexOf(target);this.layers.splice(position==='below'?index:index+1,0,layer);this.activeId=layer.id;this.changed();
  }
  moveLayers(targetId,position='above'){
    const roots=this.selectedRoots(),target=this.layers.find(layer=>layer.id===targetId);if(!target||!roots.length||roots.includes(target))return;const parentId=position==='inside'&&target.kind==='group'?target.id:target.parentId||null;
    if(roots.some(layer=>this.isLocked(layer)))throw Error('Unlock selected layers before moving.');if(parentId&&roots.some(layer=>this.descendants(layer.id).has(parentId)))throw Error('A group cannot be moved into itself.');if(parentId&&this.isLocked(this.layers.find(layer=>layer.id===parentId)))throw Error('The destination group is locked.');this.checkpoint('Move Layers');const ids=new Set(roots.map(layer=>layer.id));this.layers=this.layers.filter(layer=>!ids.has(layer.id));for(const layer of roots)layer.parentId=parentId;const index=this.layers.indexOf(target);    this.layers.splice(position==='below'?index:index+1,0,...roots);this.selectedLayerIds=roots.map(layer=>layer.id);this.activeId=roots.at(-1).id;this.changed();
  }
  arrangeLayers(mode){const roots=this.selectedRoots();if(!roots.length)return;const parent=roots[0].parentId||null;if(roots.some(layer=>(layer.parentId||null)!==parent))throw Error('Choose layers within the same group.');if(roots.some(layer=>this.isLocked(layer)))throw Error('Unlock the selected layers first.');this.checkpoint(mode==='front'?'Bring to Front':mode==='back'?'Send to Back':'Reverse');if(mode==='reverse'){const indexes=this.layers.map((layer,index)=>roots.includes(layer)?index:-1).filter(index=>index>=0),items=indexes.map(index=>this.layers[index]).reverse();indexes.forEach((index,n)=>{this.layers[index]=items[n];});}else{const rest=this.layers.filter(layer=>!roots.includes(layer));this.layers=rest;const slots=this.layers.map((layer,index)=>(layer.parentId||null)===parent?index:-1).filter(index=>index>=0);this.layers.splice(mode==='front'?(slots.at(-1)??this.layers.length-1)+1:slots[0]??0,0,...roots);}this.changed();}
  hideSelected(){if(!this.selectedLayers.length)return;this.checkpoint('Hide Layers');for(const layer of this.selectedLayers)layer.visible=false;this.changed();}
  deleteHiddenLayers(){const hidden=this.layers.filter(layer=>layer.visible===false&&!( !layer.parentId&&!layer.kind&&layer.lockAlpha&&layer.lockPosition));if(!hidden.length)return;this.checkpoint('Delete Hidden Layers');const ids=new Set();for(const layer of hidden)for(const id of this.descendants(layer.id))ids.add(id);this.layers=this.layers.filter(layer=>!ids.has(layer.id));if(!this.layers.some(layer=>layer.id===this.activeId))this.activeId=this.layers.at(-1)?.id||null;this.selectedLayerIds=this.activeId?[this.activeId]:[];this.changed();}
  deleteEmptyLayers(){const empty=this.layers.filter(layer=>{if(layer.kind==='group'||layer.kind==='adjustment'||layer.text||layer.shape||(!layer.parentId&&!layer.kind&&layer.lockAlpha&&layer.lockPosition)||!layer.canvas)return false;const data=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height).data;for(let i=3;i<data.length;i+=4)if(data[i])return false;return true;});if(!empty.length)return;this.checkpoint('Delete Empty Layers');const ids=new Set(empty.map(layer=>layer.id));this.layers=this.layers.filter(layer=>!ids.has(layer.id));if(!this.layers.some(layer=>layer.id===this.activeId))this.activeId=this.layers.at(-1)?.id||null;this.selectedLayerIds=this.activeId?[this.activeId]:[];this.changed();}
  mergeVisible(){const visible=this.layers.filter(layer=>layer.visible!==false);if(visible.length<2)return;this.checkpoint('Merge Visible');const pixels=this.composite();this.layers=this.layers.filter(layer=>layer.visible===false);const layer={id:crypto.randomUUID(),name:'Merged',visible:true,locked:false,opacity:1,blend:'source-over',x:0,y:0,canvas:pixels};this.layers.push(layer);this.activeId=layer.id;this.selectedLayerIds=[layer.id];this.changed();}
  selectAllLayers(){if(!this.layers.length)return;this.selectedLayerIds=this.layers.map(layer=>layer.id);this.activeId=this.layers.at(-1).id;this.changed();}
  deselectLayers(){this.selectedLayerIds=[];this.activeId=null;this.changed();}
  clearSlices(){if(!this.slices.length)return;this.checkpoint('Clear Slices');this.slices=[];this.changed();}
  purgeHistories(){this.undoStack=[];this.redoStack=[];this.historyBytes=0;}
  createTimeline(duration=30,fps=30){this.timeline=timelineCreate(duration,fps);this.dirty=true;this.revision++;this.dispatchEvent(new Event('change'));}
  deleteTimeline(){if(!this.timeline)throw Error('No timeline (create one first).');this.timeline=null;this.dirty=true;this.revision++;this.dispatchEvent(new Event('change'));}
  setTimelineFrame(frame){if(!this.timeline)throw Error('No timeline (create one first).');this.timeline.current=timelineFrame(this.timeline,frame);this.revision++;this.dispatchEvent(new Event('change'));}
  stepTimeline(delta){if(!this.timeline)throw Error('No timeline (create one first).');this.timeline.current=timelineStep(this.timeline,delta);this.revision++;this.dispatchEvent(new Event('change'));}
  layerFromBackground(){const bg=this.layers.find(layer=>!layer.parentId&&!layer.kind&&!layer.clipping&&layer.lockAlpha&&layer.lockPosition);if(!bg)return;this.checkpoint('Layer From Background');bg.lockAlpha=false;bg.lockPosition=false;bg.locked=false;bg.name='Layer 0';this.changed();}
  backgroundFromLayer(){const layer=this.active;if(!layer||layer.kind||layer.parentId||layer.text||layer.shape)throw Error('Select a plain pixel layer to make the Background.');if(this.layers.some(item=>!item.parentId&&!item.kind&&!item.clipping&&item.lockAlpha&&item.lockPosition))throw Error('The document already has a Background.');this.checkpoint('Background From Layer');const ctx=layer.canvas.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#ffffff';ctx.fillRect(0,0,layer.canvas.width,layer.canvas.height);ctx.globalCompositeOperation='source-over';layer.lockAlpha=true;layer.lockPosition=true;layer.locked=false;layer.name='Background';layer.opacity=1;layer.blend='source-over';this.layers.splice(this.layers.indexOf(layer),1);this.layers.unshift(layer);this.activeId=layer.id;this.selectedLayerIds=[layer.id];this.changed();}
  lockSelected(){if(!this.selectedLayers.length)return;this.checkpoint('Lock Layers');for(const layer of this.selectedLayers)layer.locked=true;this.changed();}
  propertyBounds(layer=this.active){
    if(!layer)return null;if(this._propertyBounds?.revision===this.revision&&this._propertyBounds.layer===layer)return this._propertyBounds.bounds;
    const {width,height}=layer.canvas,data=layer.canvas.getContext('2d').getImageData(0,0,width,height).data;let left=width,top=height,right=0,bottom=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
    const bounds=right>left&&bottom>top?{x:layer.x+left,y:layer.y+top,width:right-left,height:bottom-top}:null;
    this._propertyBounds={revision:this.revision,layer,bounds};return bounds;
  }
  setProperty(key,value,linked=true){
    const layer=this.active,b=this.propertyBounds();if(!layer||!b)return;
    if(this.isPositionLocked(layer))throw Error('Unlock the layer position before transforming.');
    if(!Number.isFinite(value)||Math.abs(value)>300000)throw Error('Enter a value between -300000 and 300000.');
    if(key==='X'||key==='Y'){const dx=key==='X'?Math.round(value-b.x):0,dy=key==='Y'?Math.round(value-b.y):0;if(dx||dy)this.translateLayers(dx,dy,true,[layer]);return;}
    if(!['W','H'].includes(key))throw Error('Unknown transform field.');
    let width=key==='W'?Math.max(1,value):b.width,height=key==='H'?Math.max(1,value):b.height;
    if(linked){if(key==='W')height=Math.max(1,width*b.height/b.width);else width=Math.max(1,height*b.width/b.height);}
    if(Math.abs(width-b.width)<.5&&Math.abs(height-b.height)<.5)return;
    const sx=width/b.width,sy=height/b.height;
    this.transformLayer({scaleX:sx,scaleY:sy,x:b.x+sx*(layer.x-b.x)-layer.canvas.width/2*(1-sx),y:b.y+sy*(layer.y-b.y)-layer.canvas.height/2*(1-sy),label:'Transform'});
  }
  linkLayers(){
    const selected=this.selectedLayers;if(!selected.length||selected.length===1&&!selected[0].linkGroup)return;
    const first=selected[0].linkGroup,unlink=Boolean(first)&&selected.every(layer=>layer.linkGroup===first);
    const group=unlink?null:crypto.randomUUID();this.checkpoint('Link Layers');
    for(const layer of selected)layer.linkGroup=group;
    const counts=new Map();for(const layer of this.layers)if(layer.linkGroup)counts.set(layer.linkGroup,(counts.get(layer.linkGroup)||0)+1);
    for(const layer of this.layers)if(layer.linkGroup&&counts.get(layer.linkGroup)<2)layer.linkGroup=null;
    this.changed();
  }
  moveRoots(roots=this.selectedRoots()){
    const groups=new Set(roots.map(layer=>layer.linkGroup).filter(Boolean)),linked=this.layers.filter(layer=>roots.includes(layer)||groups.has(layer.linkGroup)),ids=new Set(linked.map(layer=>layer.id));
    return linked.filter(layer=>{let parent=layer.parentId;while(parent){if(ids.has(parent))return false;parent=this.layers.find(item=>item.id===parent)?.parentId;}return true;});
  }
  translateLayers(dx,dy,record=true,roots=this.selectedRoots()){
    if(this.selectedLayers.length===1&&this.active?.mask&&this.active.editMask&&this.active.maskLinked===false){if(this.isLocked(this.active))throw Error('Unlock this layer before moving its mask.');if(record)this.checkpoint('Move Layer Mask');this.active.maskOffsetX=(this.active.maskOffsetX||0)+dx;this.active.maskOffsetY=(this.active.maskOffsetY||0)+dy;this.changed();return;}
    const ids=new Set();for(const layer of this.moveRoots(roots))for(const id of this.descendants(layer.id))ids.add(id);const layers=this.layers.filter(layer=>ids.has(layer.id)&&layer.kind!=='group');if(this.layers.some(layer=>ids.has(layer.id)&&this.isPositionLocked(layer)))throw Error('Unlock selected layer positions before moving.');if(record)this.checkpoint('Move Layers');for(const layer of this.layers.filter(item=>ids.has(item.id)&&item.kind==='group'&&item.mask&&item.maskLinked!==false)){layer.maskOffsetX=(layer.maskOffsetX||0)+dx;layer.maskOffsetY=(layer.maskOffsetY||0)+dy;}for(const layer of this.layers.filter(item=>ids.has(item.id)&&item.kind==='group'&&item.vectorMask?.path&&item.vectorMask.linked!==false))transformPath(layer.vectorMask.path,(px,py)=>({x:px+dx,y:py+dy}));for(const layer of layers)this.positionLayer(layer,layer.x+dx,layer.y+dy);this.changed();
  }
  positionLayer(layer,x,y,ignoreLocks=false){if(!ignoreLocks&&this.isPositionLocked(layer))throw Error('Unlock the layer position before moving.');const dx=x-layer.x,dy=y-layer.y;if(layer.mask&&layer.maskLinked===false){layer.maskOffsetX=(layer.maskOffsetX||0)-dx;layer.maskOffsetY=(layer.maskOffsetY||0)-dy;}if(layer.vectorMask?.path&&layer.vectorMask.linked!==false)transformPath(layer.vectorMask.path,(px,py)=>({x:px+dx,y:py+dy}));if(layer.smartFilterMask?.linked){layer.smartFilterMask.x+=dx;layer.smartFilterMask.y+=dy;}layer.x=x;layer.y=y;if(layer.kind==='smart'&&layer.smartOrigin){layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);translateSmartRecord(layer,dx,dy);}}
  alignLayers(action){
    const layers=this.selectedLayers;if(!layers.length)return;if(layers.some(layer=>this.isPositionLocked(layer)||layer.kind==='group'))throw Error('Select image layers with unlocked positions to align.');
    const selection=this.selection&&!this.selection.inverse?this.selection:null,bounds=selection|| (layers.length===1?{x:0,y:0,w:this.width,h:this.height}:{x:Math.min(...layers.map(l=>l.x)),y:Math.min(...layers.map(l=>l.y)),w:0,h:0});
    if(!selection&&layers.length>1){bounds.w=Math.max(...layers.map(l=>l.x+l.canvas.width))-bounds.x;bounds.h=Math.max(...layers.map(l=>l.y+l.canvas.height))-bounds.y;}
    const edgeName={topEdges:'top',verticalCenters:'vcenter',bottomEdges:'bottom',leftEdges:'left',horizontalCenters:'hcenter',rightEdges:'right',top:'top',centerV:'vcenter',bottom:'bottom',left:'left',centerH:'hcenter',right:'right',distributeTop:'top',distributeVCenter:'vcenter',distributeBottom:'bottom',distributeLeft:'left',distributeHCenter:'hcenter',distributeRight:'right'}[action];
    const distributing=action.startsWith('distribute');
    if(distributing&&layers.length<3)throw Error('Select at least three layers to distribute.');this.checkpoint(distributing?'Distribute Layers':'Align Layers');const move=(layer,x,y)=>this.positionLayer(layer,Math.round(x),Math.round(y));
    const edge2=(layer,kind)=>{const x=layer.x,y=layer.y,r=x+layer.canvas.width,b=y+layer.canvas.height;if(kind==='top')return 2*y;if(kind==='bottom')return 2*b;if(kind==='vcenter')return y+b;if(kind==='left')return 2*x;if(kind==='right')return 2*r;return x+r;};
    if(action==='distributeH'||action==='distributeV'){const vertical=action==='distributeV',lo=layer=>vertical?layer.y:layer.x,hi=layer=>vertical?layer.y+layer.canvas.height:layer.x+layer.canvas.width,ordered=layers.slice().sort((a,b)=>(lo(a)+hi(a))-(lo(b)+hi(b))||lo(a)-lo(b)),span=hi(ordered.at(-1))-lo(ordered[0]),total=ordered.reduce((sum,layer)=>sum+hi(layer)-lo(layer),0),gap=(span-total)/(ordered.length-1);let cursor=lo(ordered[0]);for(const layer of ordered){const want=Math.round(cursor),delta=want-lo(layer);move(layer,vertical?layer.x:layer.x+delta,vertical?layer.y+delta:layer.y);cursor+=hi(layer)-lo(layer)+gap;}}
    else if(distributing){const kind=edgeName,vertical=kind==='top'||kind==='vcenter'||kind==='bottom',ordered=layers.slice().sort((a,b)=>edge2(a,kind)-edge2(b,kind)),first=edge2(ordered[0],kind),last=edge2(ordered.at(-1),kind);ordered.forEach((layer,index)=>{const want=first+(last-first)*index/(ordered.length-1),delta=Math.round((want-edge2(layer,kind))/2);move(layer,vertical?layer.x:layer.x+delta,vertical?layer.y+delta:layer.y);});}
    else for(const layer of layers){const kind=edgeName||action;let x=layer.x,y=layer.y;if(kind==='left')x=bounds.x;if(kind==='hcenter')x=bounds.x+(bounds.w-layer.canvas.width)/2;if(kind==='right')x=bounds.x+bounds.w-layer.canvas.width;if(kind==='top')y=bounds.y;if(kind==='vcenter')y=bounds.y+(bounds.h-layer.canvas.height)/2;if(kind==='bottom')y=bounds.y+bounds.h-layer.canvas.height;move(layer,x,y);}this.changed();
  }
  addAdjustment(name, amount) {
    const layer=this.addLayer(name);layer.kind='adjustment';layer.adjustment={name,amount};this.changed();return layer;
  }
  get activePath(){return this.paths.find(path=>path.id===this.activePathId);}
  addPath(){this.checkpoint('New Path');const path={id:crypto.randomUUID(),name:'Path '+(this.paths.length+1),nodes:[],closed:false};this.paths.push(path);this.activePathId=path.id;this.changed();return path;}
  pathSelection(){if(!this.activePath||this.activePath.nodes.length<2)return;const path=structuredClone(this.activePath);this.setSelection({...pathBounds(path),kind:'path',path});}
  selectionPath(){if(!this.selection)return;const paths=selectionPaths(this.selection);if(!paths.length)return;this.checkpoint('Make Work Path');for(const path of paths){path.id=crypto.randomUUID();path.name='Work Path '+(this.paths.length+1);this.paths.push(path);this.activePathId=path.id;}this.changed();}
  paintPath(color,width=0){
    const path=this.activePath,layer=this.paintLayer,maskTarget=Boolean(layer?.editMask&&layer.mask);if(!path||!layer||this.isLocked(layer)||(['adjustment','group','smart'].includes(layer.kind)&&!maskTarget))return;
    const target=maskTarget?layer.mask:layer.canvas,origin=maskTarget?this.maskOrigin(layer):layer,alphaTarget=maskTarget||layer.kind==='channel';this.checkpoint(width?'Stroke Path':'Fill Path');
    this.editPixels(target,context=>{tracePath(context,path,-origin.x,-origin.y);context.lineWidth=width;context.lineJoin=context.lineCap='round';
      if(alphaTarget){const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),level=(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)/255;context.globalCompositeOperation='destination-out';context.fillStyle=context.strokeStyle='#fff';if(width)context.stroke();else context.fill(path.fillRule||'nonzero');context.globalCompositeOperation='source-over';context.globalAlpha=level;context.fillStyle=context.strokeStyle='#fff';if(width)context.stroke();else context.fill(path.fillRule||'nonzero');}
      else{context.fillStyle=context.strokeStyle=color;if(width)context.stroke();else context.fill(path.fillRule||'nonzero');}
    },origin);
    if(!maskTarget&&layer.kind!=='channel'){layer.text=null;layer.shape=null;}this.changed();
  }
  removeLayer() {
    const selected=this.selectedRoots();if(!selected.length)return;if(selected.some(layer=>this.isLocked(layer)))throw Error('Unlock the selected layers before deleting.');this.checkpoint('Delete Layers');const index=this.layers.indexOf(this.active),ids=new Set();for(const layer of selected)for(const id of this.descendants(layer.id))ids.add(id);this.layers=this.layers.filter(layer=>!ids.has(layer.id));this.activeId=this.layers[Math.min(index,this.layers.length-1)]?.id||null;this.selectedLayerIds=this.activeId?[this.activeId]:[];this.changed();
  }
  transformLayer(settings,record=true,ignoreLocks=false){
    const layer=this.active;if(!layer||this.isLocked(layer)&&!ignoreLocks)return;
    if(!ignoreLocks&&this.isPositionLocked(layer))throw Error('Unlock the layer position before transforming.');
    if(['adjustment','group'].includes(layer.kind))throw Error('Select an image or type layer to transform, or merge the group first.');
    const matrix=layerMatrix(layer,settings),bounds=transformedBounds(matrix,layer.canvas.width,layer.canvas.height);
    if(!Object.values(bounds).every(Number.isFinite)||bounds.width*bounds.height>64000000||bounds.width>32767||bounds.height>32767)throw Error('The transformed layer exceeds the image size limit.');
    const transform=(source,m=matrix,b=bounds)=>{const output=surface(b.width,b.height),ctx=output.getContext('2d');applyCanvasInterpolation(ctx,settings.interpolation);ctx.setTransform(m[0],m[1],m[2],m[3],m[4]-b.x,m[5]-b.y);ctx.drawImage(source,0,0);return output;};
    const editableText=layer.text,editableShape=transformedShape(layer.shape,matrix,bounds),maskOrigin=layer.mask?this.maskOrigin(layer):null,mask=layer.maskLinked===false?null:layer.mask,vectorOrigin=layer.vectorMask?.path&&layer.vectorMask.linked!==false?{x:layer.x,y:layer.y}:null;let maskMatrix=null,maskBounds=null;if(mask){const dx=maskOrigin.x-layer.x,dy=maskOrigin.y-layer.y;maskMatrix=[...matrix];maskMatrix[4]+=matrix[0]*dx+matrix[2]*dy;maskMatrix[5]+=matrix[1]*dx+matrix[3]*dy;maskBounds=transformedBounds(maskMatrix,mask.width,mask.height);if(!Object.values(maskBounds).every(Number.isFinite)||maskBounds.width>32767||maskBounds.height>32767||maskBounds.width*maskBounds.height>64000000)throw Error('The transformed mask exceeds the image size limit.');}const transformedCanvas=transform(layer.canvas),transformedMask=mask?transform(mask,maskMatrix,maskBounds):null;
    if(record){const label=settings.label||'Free Transform';const stored={...settings};delete stored.label;this.checkpoint(label);if(layer.kind==='smart')layer.smartOperations=[...(layer.smartOperations||[]),{type:'transform',settings:stored}];}
    layer.canvas=transformedCanvas;if(vectorOrigin)transformPath(layer.vectorMask.path,(px,py)=>affinePoint(matrix,px-vectorOrigin.x,py-vectorOrigin.y));if(mask){layer.mask=transformedMask;layer.maskOffsetX=maskBounds.x-bounds.x;layer.maskOffsetY=maskBounds.y-bounds.y;}else if(maskOrigin){layer.maskOffsetX=maskOrigin.x-bounds.x;layer.maskOffsetY=maskOrigin.y-bounds.y;}
    layer.x=bounds.x;layer.y=bounds.y;layer.text=editableText?{...editableText,matrix:multiplyAffine([matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds.x,matrix[5]-bounds.y],editableText.matrix||[1,0,0,1,0,0])}:null;layer.shape=editableShape;this.changed();
  }
  transformTypeLayer(layer,settings){const activeId=this.activeId,linked=layer.maskLinked,vectorLinked=layer.vectorMask?.linked;this.activeId=layer.id;layer.maskLinked=true;if(layer.vectorMask)layer.vectorMask.linked=true;try{this.transformLayer(settings,false,true);}finally{this.activeId=activeId;layer.maskLinked=linked;if(layer.vectorMask)layer.vectorMask.linked=vectorLinked;}}
  convertSmart(){const layer=this.active;if(!layer||this.isLocked(layer)||['adjustment','group','smart'].includes(layer.kind))return;this.checkpoint('Convert to Smart Object');layer.kind='smart';layer.smartContentsId=crypto.randomUUID();layer.smartSource=copyCanvas(layer.canvas);layer.smartOrigin={x:layer.x,y:layer.y};layer.smartOperations=[];layer.text=null;layer.shape=null;this.changed();}
  rebuildSmart(layer=this.active){
    if(layer?.kind!=='smart'||!layer.smartSource)return;
    const filterBase=this.smartMaskActive(layer)?this.renderSmartBase(layer):null;
    const activeId=this.activeId,selection=this.selection,previousReplay=this._smartReplayLayerId,mask=layer.mask,vectorMask=layer.vectorMask,maskOrigin=mask?this.maskOrigin(layer):null,offsetX=layer.maskOffsetX||0,offsetY=layer.maskOffsetY||0,old={canvas:layer.canvas,x:layer.x,y:layer.y,text:layer.text,shape:layer.shape};
    this._smartReplayLayerId=layer.id;this.activeId=layer.id;
    try{
      layer.canvas=copyCanvas(layer.smartSource);layer.x=layer.smartOrigin?.x||0;layer.y=layer.smartOrigin?.y||0;layer.mask=null;layer.vectorMask=null;layer.kind=null;
      for(const operation of layer.smartOperations||[]){
        if(operation.enabled===false)continue;
        if(operation.type==='filter'){
          if(layer.smartFiltersEnabled===false)continue;
          const before=operation.blend&&operation.blend!=='source-over'||operation.opacity!=null&&operation.opacity<1?{canvas:copyCanvas(layer.canvas),x:layer.x,y:layer.y}:null;
          this.selection=offsetSelection(operation.selection,layer.x-(operation.selectionOrigin?.x||0),layer.y-(operation.selectionOrigin?.y||0));this.filter(operation.name,operation.amount,false);
          if(before)this.blendSmartFilter(layer,before,operation.blend||'source-over',operation.opacity??1);
        }else if(operation.type==='resizePixels')this.resizeSmartPixels(layer,operation.settings);
        else if(operation.type==='transform')this.transformLayer(operation.settings,false,true);
        else if(operation.type==='perspective')this.perspectiveLayer(operation.quad,false,operation.interpolation||'bilinear');
        else if(operation.type==='warpPlace')this.warpPlace(operation);
      }
      layer.mask=mask;layer.vectorMask=vectorMask;layer.maskOffsetX=maskOrigin&&layer.maskLinked===false?maskOrigin.x-layer.x:offsetX;layer.maskOffsetY=maskOrigin&&layer.maskLinked===false?maskOrigin.y-layer.y:offsetY;
      if(filterBase)this.applySmartFilterMask(layer,filterBase);
    }catch(error){Object.assign(layer,old);layer.maskOffsetX=offsetX;layer.maskOffsetY=offsetY;throw error;}
    finally{layer.kind='smart';layer.mask=mask;layer.vectorMask=vectorMask;this.activeId=activeId;this.selection=selection;this._smartReplayLayerId=previousReplay;}
    this.changed();
  }

  warpPlace(operation){const layer=this.active,image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),result=warpPlacePixels(image,operation),canvas=surface(result.width,result.height);canvas.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);layer.canvas=canvas;layer.x=result.x;layer.y=result.y;}
  blendSmartFilter(layer,before,blend,opacity){
    const x=Math.floor(Math.min(before.x,layer.x)),y=Math.floor(Math.min(before.y,layer.y)),width=Math.ceil(Math.max(before.x+before.canvas.width,layer.x+layer.canvas.width))-x,height=Math.ceil(Math.max(before.y+before.canvas.height,layer.y+layer.canvas.height))-y;
    if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The blended smart filter exceeds the image size limit.');
    const back=surface(width,height),front=surface(width,height),context=back.getContext('2d');context.drawImage(before.canvas,before.x-x,before.y-y);front.getContext('2d').drawImage(layer.canvas,layer.x-x,layer.y-y);
    if(customBlends.has(blend))compositeCustom(back,front,blend,opacity,0,x,y);else{context.globalAlpha=opacity;context.globalCompositeOperation=blend;context.drawImage(front,0,0);}
    layer.canvas=back;layer.x=x;layer.y=y;
  }

  renderSmartBase(layer){
    if([1,3,4,8,9].includes(layer.smartPsd?.cacheColorMode)){const pixels=unfilteredRGBRecord(layer.smartFeid,layer.smartPsd.cacheColorMode);if(pixels){const canvas=surface(pixels.width,pixels.height);canvas.getContext('2d').putImageData(new ImageData(pixels.data,pixels.width,pixels.height),0,0);return{canvas,x:pixels.x,y:pixels.y};}}
    const temporary=new EditorDocument(this.width,this.height),copy={...layer,canvas:copyCanvas(layer.canvas),mask:null,vectorMask:null,smartFilterMask:null,smartOperations:(layer.smartOperations||[]).filter(operation=>operation.type!=='filter')};
    temporary.layers=[copy];temporary.activeId=copy.id;temporary.rebuildSmart(copy);return{canvas:copy.canvas,x:copy.x,y:copy.y};
  }
  filterMaskPixels(layer,base,inverse=false){
    const mask=layer.smartFilterMask,read=(canvas,x,y)=>({data:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,x,y});
    const result=combineFilterMask(read(base.canvas,base.x,base.y),read(layer.canvas,layer.x,layer.y),{...read(mask.canvas,mask.x,mask.y),extendWhite:mask.extendWhite},inverse),canvas=surface(result.width,result.height);canvas.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);return{canvas,x:result.x,y:result.y};
  }
  smartMaskActive(layer){return Boolean(layer.smartFilterMask?.canvas&&layer.smartFilterMask.enabled!==false&&layer.smartFiltersEnabled!==false&&((layer.smartOperations||[]).some(operation=>operation.type==='filter'&&operation.enabled!==false)||(layer.smartPsd?.filter?.list||[]).some(filter=>filter.enabled!==false)));}
  applySmartFilterMask(layer,base){
    if(!this.smartMaskActive(layer))return;
    const origin=layer.mask?this.maskOrigin(layer):null,result=this.filterMaskPixels(layer,base||this.renderSmartBase(layer));layer.canvas=result.canvas;layer.x=result.x;layer.y=result.y;if(origin){layer.maskOffsetX=origin.x-layer.x;layer.maskOffsetY=origin.y-layer.y;}
  }
  smartExportPixels(layer){
    if((typeof layer.smartDocument!=='string'&&![1,3,4,8,9].includes(layer.smartPsd?.cacheColorMode))||!this.smartMaskActive(layer))return{canvas:layer.canvas,x:layer.x,y:layer.y};
    return this.filterMaskPixels(layer,this.renderSmartBase(layer),true);
  }

  rasterizeSmart(){const layer=this.active;if(layer?.kind!=='smart'||this.isLocked(layer))return;this.checkpoint('Rasterize Smart Object');layer.kind=null;layer.smartLink=null;layer.smartContentsId=null;layer.smartSource=null;layer.smartOperations=null;layer.smartDocument=null;layer.smartPsd=null;layer.smartFile=null;layer.smartFeid=null;layer.smartImportQuad=null;layer.smartFilterMask=null;layer.smartFiltersEnabled=true;layer.fill=null;this.changed();}
  applyPerspectiveResult(result,quad,record=true){const layer=this.active;if(!layer||this.isLocked(layer))return;const maskOrigin=layer.mask?this.maskOrigin(layer):null;if(record){this.checkpoint('Perspective Transform');if(layer.kind==='smart')layer.smartOperations=[...(layer.smartOperations||[]),{type:'perspective',quad:structuredClone(quad)}];}if(layer.vectorMask?.path&&layer.vectorMask.linked!==false){const forward=quadMapping([{x:0,y:0},{x:layer.canvas.width,y:0},{x:layer.canvas.width,y:layer.canvas.height},{x:0,y:layer.canvas.height}],quad),ox=layer.x,oy=layer.y;transformPath(layer.vectorMask.path,(px,py)=>{const x=px-ox,y=py-oy,den=forward[6]*x+forward[7]*y+1;return !Number.isFinite(den)||Math.abs(den)<1e-10?{x:px,y:py}:{x:(forward[0]*x+forward[1]*y+forward[2])/den,y:(forward[3]*x+forward[4]*y+forward[5])/den};});}const canvas=surface(result.image.width,result.image.height);canvas.getContext('2d').putImageData(result.image,0,0);layer.canvas=canvas;layer.x=result.x;layer.y=result.y;if(layer.maskLinked===false&&maskOrigin){layer.maskOffsetX=maskOrigin.x-layer.x;layer.maskOffsetY=maskOrigin.y-layer.y;}else{layer.maskOffsetX=layer.maskOffsetY=0;if(result.mask){const mask=surface(result.mask.width,result.mask.height);mask.getContext('2d').putImageData(result.mask,0,0);layer.mask=mask;}}layer.text=null;layer.shape=null;this.changed();}
  perspectiveLayer(quad,record=true,interpolation='bilinear'){const layer=this.active;if(!layer||this.isLocked(layer))return;const read=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),result=perspectivePixels(read(layer.canvas),quad,interpolation),mask=layer.mask?perspectivePixels(read(this.alignedMask(layer)),quad,interpolation):null;this.applyPerspectiveResult({x:result.x,y:result.y,image:new ImageData(result.data,result.width,result.height),mask:mask?new ImageData(mask.data,mask.width,mask.height):null},quad,record);}
  replaceEmbeddedContents(layer,pixels,project,options={}){
    const link=options.link===undefined?undefined:smartLinkRecord(options.link);
    if(layer.kind!=='smart'||!layer.smartSource)throw Error('Select a Smart Object with source pixels.');
    const contentsId=layer.smartContentsId||layer.smartPsd?.id||crypto.randomUUID(),instances=this.layers.filter(item=>item.kind==='smart'&&(item===layer||item.smartContentsId===contentsId)),prepared=instances.map(item=>{if(!item.smartSource)throw Error('A shared Smart Object has no source pixels.');const origin=item.smartOrigin||{x:item.x,y:item.y},operations=pixels.width===item.smartSource.width&&pixels.height===item.smartSource.height?structuredClone(item.smartOperations||[]):rebaseFillHistory(item.smartOperations,{...origin,width:item.smartSource.width,height:item.smartSource.height},{...origin,width:pixels.width,height:pixels.height});return{layer:item,operations,source:copyCanvas(pixels)};}),priorRedo=this.redoStack,wasDirty=this.dirty,previousBatch=this._smartBatchUpdate;
    if(!instances.length)throw Error('The shared Smart Object is no longer available.');
    this.checkpoint(options.label||'Update Embedded Contents');const checkpoint=this.undoStack.at(-1);try{this._smartBatchUpdate=true;for(const item of prepared){item.layer.smartContentsId=contentsId;item.layer.smartSource=item.source;item.layer.smartDocument=project;if(link!==undefined)item.layer.smartLink=link?{...link}:null;item.layer.smartOperations=item.operations;this.rebuildSmart(item.layer);}this._smartBatchUpdate=previousBatch;this.changed();return instances.map(item=>item.id);}catch(error){this._smartBatchUpdate=previousBatch;if(this.undoStack.at(-1)===checkpoint){this.undoStack.pop();this.historyBytes-=checkpoint.bytes;}this.redoStack=priorRedo;this.restore(checkpoint.state);this.dirty=wasDirty;this.dispatchEvent(new Event('change'));throw error;}
  }
  canRefreshFill(layer){return layer.kind==='smart'&&Boolean(layer.fill)&&(layer.smartOperations||[]).every(operation=>['filter','transform','perspective','resizePixels'].includes(operation.type));}
  refreshFill(layer,width,height){
    if(!this.canRefreshFill(layer))return false;
    const origin=layer.mask?this.maskOrigin(layer):null,geometry=(layer.smartOperations||[]).some(operation=>operation.type!=='filter'),sourceOrigin=layer.smartOrigin||{x:layer.x,y:layer.y},settings={...layer.fill,width,height},newOrigin=geometry?{...sourceOrigin}:{x:0,y:0};
    const operations=geometry?rebaseFillHistory(layer.smartOperations,{...sourceOrigin,width:layer.smartSource.width,height:layer.smartSource.height},{...newOrigin,width,height}):translateSmartOperations(layer.smartOperations,-layer.x,-layer.y);
    const pixels=renderFill(settings);layer.fill=settings;layer.smartSource=pixels;layer.smartOrigin=newOrigin;layer.smartOperations=operations.map(operation=>{if(operation.type!=='filter'||!operation.amount||typeof operation.amount!=='object')return operation;const amount={...operation.amount};if('documentWidth'in amount)amount.documentWidth=width;if('documentHeight'in amount)amount.documentHeight=height;return{...operation,amount};});this.rebuildSmart(layer);
    if(origin){layer.maskOffsetX=origin.x-layer.x;layer.maskOffsetY=origin.y-layer.y;}return true;
  }
  resizeSmartPixels(layer,settings){
    const {scaleX,scaleY,method,canvasWidth,canvasHeight}=settings;
    if(![scaleX,scaleY].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid Smart Object resize scale.');
    const oldX=layer.x,oldY=layer.y,ix=Math.floor(oldX),iy=Math.floor(oldY);let canvas=layer.canvas;
    if(ix!==oldX||iy!==oldY){const aligned=surface(Math.ceil(oldX+canvas.width)-ix,Math.ceil(oldY+canvas.height)-iy);aligned.getContext('2d').drawImage(canvas,oldX-ix,oldY-iy);canvas=aligned;}
    const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),result=resamplePixels(image,ix,iy,scaleX,scaleY,method||'bicubic',canvasWidth,canvasHeight),output=surface(result.width,result.height);output.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);layer.canvas=output;layer.x=result.x+(Number(settings.offsetX)||0);layer.y=result.y+(Number(settings.offsetY)||0);
  }
  transformSmartLayer(layer,settings){const activeId=this.activeId,linked=layer.maskLinked,vectorLinked=layer.vectorMask?.linked;this.activeId=layer.id;layer.maskLinked=true;if(layer.vectorMask)layer.vectorMask.linked=true;try{layer.smartOperations=[...(layer.smartOperations||[]),{type:'transform',settings:structuredClone(settings)}];this.transformLayer(settings,false,true);}finally{this.activeId=activeId;layer.maskLinked=linked;if(layer.vectorMask)layer.vectorMask.linked=vectorLinked;}}
  trim(){
    const {data}=this.composite().getContext('2d').getImageData(0,0,this.width,this.height);
    let left=this.width,top=this.height,right=-1,bottom=-1;
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)if(data[(y*this.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    if(right>=left)this.crop({x:left,y:top,w:right-left+1,h:bottom-top+1});
  }
  revealAll(){
    let left=0,top=0,right=this.width,bottom=this.height;
    for(const layer of this.layers){if(['adjustment','group'].includes(layer.kind))continue;const canvas=this.layerPixels(layer),{data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}if(maxX>=minX){left=Math.min(left,layer.x+minX);top=Math.min(top,layer.y+minY);right=Math.max(right,layer.x+maxX+1);bottom=Math.max(bottom,layer.y+maxY+1);}}
    const width=right-left,height=bottom-top;if(left===0&&top===0&&width===this.width&&height===this.height)return false;if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('Reveal All would exceed 32,767 pixels per side or 64 million pixels.');
    this.checkpoint('Reveal All');const dx=-left,dy=-top;
    for(const layer of this.layers){if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(width,height):null;if(mask)mask.getContext('2d').drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)+dx,layer.y+(layer.maskOffsetY||0)+dy);layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(width,height);layer.x=layer.y=0;continue;}layer.x+=dx;layer.y+=dy;if(layer.kind==='smart'){layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);translateSmartRecord(layer,dx,dy,true);}}
    for(const channel of [...this.channels,...(this.quickMask?[this.quickMask]:[])]){const next=surface(width,height);next.getContext('2d').drawImage(channel.canvas,dx,dy);channel.canvas=next;}this.guides=this.guides.map(guide=>({...guide,position:guide.position+(guide.axis==='vertical'?dx:dy)}));this.paths.forEach(path=>transformPath(path,(x,y)=>({x:x+dx,y:y+dy})));this.layers.forEach(layer=>{if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>({x:x+dx,y:y+dy}));});this.width=width;this.height=height;this.selection=null;this.changed();return true;
  }
  strokeSelection(color,width=1){
    const layer=this.active,s=this.selection;if(!layer||this.isLocked(layer)||!s||layer.kind==='adjustment')return;
    this.checkpoint('Stroke Selection');const mask=surface(layer.canvas.width,layer.canvas.height),ctx=mask.getContext('2d');
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';
    if(s.kind==='path')tracePath(ctx,s.path,-layer.x,-layer.y);
    else {ctx.beginPath();if(s.kind==='ellipse')ctx.ellipse(s.x-layer.x+s.w/2,s.y-layer.y+s.h/2,s.w/2,s.h/2,0,0,Math.PI*2);
      else if(s.kind==='lasso'){s.points.forEach((p,i)=>i?ctx.lineTo(p.x-layer.x,p.y-layer.y):ctx.moveTo(p.x-layer.x,p.y-layer.y));ctx.closePath();}
      else ctx.rect(s.x-layer.x,s.y-layer.y,s.w,s.h);}
    ctx.stroke();const before=this.beginPixelEdit(layer.canvas);layer.canvas.getContext('2d').drawImage(mask,0,0);this.finishPixelEdit(layer.canvas,before);layer.text=null;layer.shape=null;this.changed();
  }
  flatten() {
    this.checkpoint('Flatten Image'); const pixels = this.composite();
    this.layers = [];this.activeId=null;this.addLayer('Background', pixels, false);
  }
  mergeDown() {
    const siblings=this.layers.filter(layer=>(layer.parentId||null)===(this.active?.parentId||null)),siblingIndex=siblings.indexOf(this.active);if(siblingIndex<1)return;
    const index = this.layers.indexOf(this.active),bottom=siblings[siblingIndex-1],top=this.active;
    if(bottom.kind==='group'||top.kind==='group'||bottom.clipping||top.clipping)throw Error('Merge or release the group and clipping mask before merging these layers.');
    if(top.kind==='adjustment'||bottom.kind==='adjustment')throw Error('Use Flatten Image to combine adjustment layers with the image.');
    this.checkpoint('Merge Down');
    const output = surface(this.width, this.height), context = output.getContext('2d');
    for (const layer of [bottom, top]) {
      if (!layer.visible) continue;
      context.globalAlpha = layer.opacity; context.globalCompositeOperation = layer.blend;
      const rendered=this.renderLayer(layer);context.drawImage(rendered.canvas,layer.x+rendered.offsetX,layer.y+rendered.offsetY);
    }
    bottom.canvas = output; bottom.x = bottom.y = 0; bottom.opacity = 1; bottom.blend = 'source-over'; bottom.mask = null; bottom.vectorMask=null; bottom.text = null;bottom.effects=null;
    this.layers.splice(index, 1); this.activeId = bottom.id; this.changed();
  }
  passThroughReady(layer,clipped){
    if(layer.kind!=='group'||!layer.passThrough||(layer.fillOpacity??1)<1||layer.x||layer.y||Object.values(layer.effects||{}).some(effect=>effect?.enabled))return false;
    return !(clipped.some(item=>item.visible)&&this.layers.some(child=>child.parentId===layer.id&&child.visible!==false&&child.kind==='adjustment'));
  }
  compositePassThrough(layer,clipped,canvas,context,visited,clippingBase,scope={root:false,isolated:false},deferOptions=false){
    const beforeCanvas=copyCanvas(canvas),before=beforeCanvas.getContext('2d').getImageData(0,0,this.width,this.height),after=this.composite(layer.id,visited,beforeCanvas,{root:false,isolated:scope.isolated}).getContext('2d').getImageData(0,0,this.width,this.height);
    const mask=this.usesCoverage(layer)?this.coverageMask(layer,this.width,this.height).getContext('2d').getImageData(0,0,this.width,this.height):null;
    const coverage=mask?new Uint8ClampedArray(mask.data.length):null;if(coverage)for(let i=0;i<coverage.length;i+=4)coverage[i+3]=Math.max(0,Math.min(255,layer.opacity*(mask.data[i+3])));else if(layer.opacity<1){const flat=new Uint8ClampedArray(before.data.length);flat.fill(0);for(let i=3;i<flat.length;i+=4)flat[i]=Math.round(layer.opacity*255);var opacityCoverage=new ImageData(flat,this.width,this.height);} 
    let current=mixImage(before,after,coverage||opacityCoverage?.data||null);
    if(clipped.some(item=>item.visible)){
      const iso=this.composite(layer.id,visited);if(this.usesCoverage(layer)){const paint=iso.getContext('2d');paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(layer,this.width,this.height),0,0);paint.globalCompositeOperation='source-over';}const clippedIso=copyCanvas(iso);
      for(const follower of clipped)if(follower.visible)this.blendFollower(clippedIso,follower,iso,visited);
      const without=copyCanvas(beforeCanvas),withCanvas=copyCanvas(beforeCanvas),under=without.getContext('2d');under.globalAlpha=layer.opacity;under.drawImage(iso,0,0);const over=withCanvas.getContext('2d');over.globalAlpha=layer.opacity;over.drawImage(clippedIso,0,0);
      current=addPremultipliedDelta(current,withCanvas.getContext('2d').getImageData(0,0,this.width,this.height),without.getContext('2d').getImageData(0,0,this.width,this.height));
    }
    if(layer.clipping&&clippingBase)current=mixImage(before,current,clippingBase.getContext('2d').getImageData(0,0,this.width,this.height).data);
    context.putImageData(current,0,0);
    if(!deferOptions&&(blendIfActive(layer.blendIf)||channelWeights(layer.excludedChannels,this.psdMode==='duotone'))){
      const own=this.composite(layer.id,visited);if(this.usesCoverage(layer)){const paint=own.getContext('2d');paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(layer,this.width,this.height),0,0);}
      this.finishBlendOptions(context,before,own.getContext('2d').getImageData(0,0,this.width,this.height),layer);
    }
  }
  blendAdjustmentPixels(original,changed,layer){
    let adjusted=changed;
    if(layer.blend&&layer.blend!=='source-over'&&layer.blend!=='dissolve'){
      const back=surface(this.width,this.height),front=surface(this.width,this.height),b=new ImageData(new Uint8ClampedArray(original.data),this.width,this.height),f=new ImageData(new Uint8ClampedArray(changed.data),this.width,this.height);
      for(let i=3;i<b.data.length;i+=4)b.data[i]=f.data[i]=255;
      back.getContext('2d').putImageData(b,0,0);front.getContext('2d').putImageData(f,0,0);
      if(customBlends.has(layer.blend))compositeCustom(back,front,layer.blend,1);else{const context=back.getContext('2d');context.globalCompositeOperation=layer.blend;context.drawImage(front,0,0);}
      adjusted=back.getContext('2d').getImageData(0,0,this.width,this.height);
    }
    const mask=this.usesCoverage(layer)?this.coverageMask(layer,this.width,this.height).getContext('2d').getImageData(0,0,this.width,this.height):null,opacity=(layer.opacity??1)*(layer.fillOpacity??1);
    for(let i=0;i<original.data.length;i+=4){const weight=opacity*(mask?mask.data[i+3]/255:1);for(let c=0;c<3;c++)original.data[i+c]+=(adjusted.data[i+c]-original.data[i+c])*weight;}return original;
  }
  blendFollower(destination,follower,clipMask,visited,knockoutHandled=false){
    if(!knockoutHandled&&(follower.knockout===1||follower.knockout===2)){
      const context=destination.getContext('2d'),before=context.getImageData(0,0,this.width,this.height),raw=surface(this.width,this.height);
      if(follower.kind==='group')raw.getContext('2d').drawImage(this.composite(follower.id,visited,null,{root:false,isolated:true}),follower.x,follower.y);
      const shape=follower.kind==='adjustment'||follower.transparencyShapes===false?this.shapelessKnockout(follower,raw):this.contentKnockout(follower,raw),knocked=new ImageData(new Uint8ClampedArray(before.data),this.width,this.height);
      knockoutBackdrop(knocked,clipMask?.getContext('2d').getImageData(0,0,this.width,this.height)||null,shape);for(let i=3;i<knocked.data.length;i+=4)knocked.data[i]=Math.min(knocked.data[i],before.data[i]);context.putImageData(knocked,0,0);
      this.blendFollower(destination,follower,clipMask,visited,true);const after=context.getImageData(0,0,this.width,this.height);knockoutOpacity(after,before,knocked,follower.opacity??1,shape);context.putImageData(after,0,0);return;
    }
    if(follower.kind==='group'&&this.passThroughReady(follower,[])){this.compositePassThrough(follower,[],destination,destination.getContext('2d'),visited,clipMask,{root:false,isolated:true});return;}
    const context=destination.getContext('2d');
    if(follower.kind==='adjustment'&&follower.adjustment){
      const original=context.getImageData(0,0,this.width,this.height),changed=new ImageData(new Uint8ClampedArray(original.data),this.width,this.height);adjustPixels(changed,follower.adjustment.name,follower.adjustment.amount);
      const before=blendIfActive(follower.blendIf)||channelWeights(follower.excludedChannels,this.psdMode==='duotone')?new ImageData(new Uint8ClampedArray(original.data),this.width,this.height):null;this.blendAdjustmentPixels(original,changed,follower);
      context.putImageData(original,0,0);this.finishBlendOptions(context,before,null,follower);return;
    }
    const temp=surface(this.width,this.height),paint=temp.getContext('2d');
    if(follower.kind==='group'){paint.drawImage(this.composite(follower.id,visited),follower.x,follower.y);if(this.usesCoverage(follower)){paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(follower,this.width,this.height),0,0);}const rendered=renderEffects(temp,follower.effects,follower.fillOpacity??1,follower.transparencyShapes!==false,follower.blendInterior===true,undefined,follower.blend);if(rendered.canvas!==temp){paint.globalCompositeOperation='copy';paint.drawImage(rendered.canvas,rendered.offsetX,rendered.offsetY);}}
    else{const rendered=this.renderLayer(follower);paint.drawImage(rendered.canvas,follower.x+rendered.offsetX,follower.y+rendered.offsetY);}
    const beforeBlend=blendIfActive(follower.blendIf)||channelWeights(follower.excludedChannels,this.psdMode==='duotone')?context.getImageData(0,0,this.width,this.height):null;
    const opaque=copyCanvas(destination),opaqueData=opaque.getContext('2d').getImageData(0,0,this.width,this.height);for(let i=3;i<opaqueData.data.length;i+=4)opaqueData.data[i]=255;opaque.getContext('2d').putImageData(opaqueData,0,0);
    const stagedFollower=Object.values(follower.effects||{}).some(effect=>effect?.enabled)?follower.kind==='group'?this.renderGroupEffects(follower,visited,opaque):this.renderLayer(follower,opaque):null,staged=stagedFollower?.stages&&this.compositeEffectStages(opaque,follower,stagedFollower);
    if(staged){}else if(follower.text&&follower.blend!=='dissolve')compositeTextGamma(opaque,temp,follower.blend,follower.opacity??1);else if(customBlends.has(follower.blend)){let seed=0;for(const character of follower.id)seed=Math.imul(seed,31)+character.charCodeAt(0)|0;compositeCustom(opaque,temp,follower.blend,follower.opacity,seed);}
    else{const over=opaque.getContext('2d');over.globalAlpha=follower.opacity;over.globalCompositeOperation=follower.blend;over.drawImage(temp,0,0);}
    const blended=opaque.getContext('2d').getImageData(0,0,this.width,this.height),base=context.getImageData(0,0,this.width,this.height);
    for(let i=0;i<base.data.length;i+=4){if(base.data[i+3]<=0)continue;base.data[i]=blended.data[i];base.data[i+1]=blended.data[i+1];base.data[i+2]=blended.data[i+2];}
    context.putImageData(base,0,0);this.finishBlendOptions(context,beforeBlend,temp.getContext('2d').getImageData(0,0,this.width,this.height),follower);
  }
  finishBlendOptions(context,before,own,layer){
    if(!before)return;const after=context.getImageData(0,0,before.width,before.height),gray=this.psdMode==='duotone',weights=channelWeights(layer.excludedChannels,gray);
    if(weights)restoreChannels(before,after,weights);if(blendIfActive(layer.blendIf))applyBlendIf(before,after,own,layer.blendIf,gray);context.putImageData(after,0,0);
  }
  backgroundCanvas(){
    const bg=this.layers.find(layer=>!layer.parentId);if(!bg||bg.kind||bg.clipping||!bg.lockAlpha||!bg.lockPosition||bg.visible===false)return null;
    const canvas=surface(this.width,this.height),rendered=this.renderLayer(bg);canvas.getContext('2d').drawImage(rendered.canvas,bg.x+(rendered.offsetX||0),bg.y+(rendered.offsetY||0));return canvas;
  }
  knockoutTarget(layer,scope,floor){if(layer.knockout===2&&scope.isolated)return null;if(layer.knockout!==2&&!scope.root)return floor||null;return this.backgroundCanvas();}
  layerGroupOwnPixels(layer){const canvas=surface(this.width,this.height),paint=canvas.getContext('2d');paint.drawImage(this.composite(layer.id,new Set(),null,{root:false,isolated:true}),layer.x,layer.y);if(this.usesCoverage(layer)){paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(layer,this.width,this.height),0,0);}return paint.getImageData(0,0,this.width,this.height);}
  contentKnockout(layer,pixels){
    const image=pixels.getContext('2d').createImageData(this.width,this.height),source=layer.kind==='group'?null:layer.canvas;
    if(source){const data=source.getContext('2d').getImageData(0,0,source.width,source.height).data,ox=Math.round(layer.x)||0,oy=Math.round(layer.y)||0;for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const dx=ox+x,dy=oy+y;if(dx<0||dy<0||dx>=this.width||dy>=this.height)continue;image.data[(dy*this.width+dx)*4+3]=data[(y*source.width+x)*4+3];}}
    else{const raw=surface(this.width,this.height);raw.getContext('2d').drawImage(this.composite(layer.id,new Set(),null,{root:false,isolated:true}),layer.x,layer.y);const data=raw.getContext('2d').getImageData(0,0,this.width,this.height).data;for(let i=3;i<data.length;i+=4)image.data[i]=data[i];}
    if(this.usesCoverage(layer)){const mask=this.coverageMask(layer,this.width,this.height).getContext('2d').getImageData(0,0,this.width,this.height).data;for(let i=3;i<image.data.length;i+=4)image.data[i]=Math.round(image.data[i]*mask[i]/255);}
    return image;
  }
  shapelessKnockout(layer,pixels){
    const image=pixels.getContext('2d').createImageData(this.width,this.height);for(let i=3;i<image.data.length;i+=4)image.data[i]=255;
    if(this.usesCoverage(layer)){const mask=this.coverageMask(layer,this.width,this.height).getContext('2d').getImageData(0,0,this.width,this.height);for(let i=3;i<image.data.length;i+=4)image.data[i]=mask.data[i];}
    return image;
  }
  renderGroupEffects(layer,visited,backdrop=null){
    const pixels=surface(this.width,this.height),paint=pixels.getContext('2d'),hidePixel=Boolean(layer.maskHidesEffects&&layer.mask&&!layer.maskDisabled),hideVector=Boolean(layer.vectorMaskHidesEffects&&layer.vectorMask?.path&&layer.vectorMask.enabled!==false);
    paint.drawImage(this.composite(layer.id,visited,null,{root:false,isolated:true}),layer.x,layer.y);this.applySelectedCoverage(layer,pixels,!hidePixel&&layer.mask&&!layer.maskDisabled,!hideVector&&layer.vectorMask?.path&&layer.vectorMask.enabled!==false,0,0);
    const rendered=renderEffects(pixels,layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,undefined,layer.blend,{x:0,y:0},null,backdrop);
    if(hidePixel||hideVector){const output=copyCanvas(rendered.canvas);this.applySelectedCoverage(layer,output,hidePixel,hideVector,rendered.offsetX||0,rendered.offsetY||0);if(rendered.stages){const hiding=surface(this.width,this.height),context=hiding.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,this.width,this.height);this.applySelectedCoverage(layer,hiding,hidePixel,hideVector,0,0);rendered.stages.hidingCoverage=context.getImageData(0,0,this.width,this.height).data;}return{...rendered,canvas:output};}
    return rendered;
  }
  compositeEffectStages(destination,layer,rendered){
    const stages=rendered.stages;if(!stages)return false;
    const before=destination.getContext('2d').getImageData(0,0,this.width,this.height),work=copyCanvas(destination),x=(layer.kind==='group'?0:layer.x)+rendered.offsetX,y=(layer.kind==='group'?0:layer.y)+rendered.offsetY;
    const paint=(image,settings={},gamma=1)=>{const aligned=surface(this.width,this.height);aligned.getContext('2d').drawImage(image,x,y);if(gamma!==1)compositeTextGamma(work,aligned,settings.blend||'source-over',settings.opacity??1,gamma);else if(customBlends.has(settings.blend))compositeCustom(work,aligned,settings.blend,settings.opacity??1);else{const ctx=work.getContext('2d');ctx.save();ctx.globalAlpha=settings.opacity??1;ctx.globalCompositeOperation=settings.blend||'source-over';ctx.drawImage(aligned,0,0);ctx.restore();}};
    for(const item of stages.exterior)paint(item.image,item.settings);paint(stages.interior,{blend:stages.interiorBlend||layer.blend||'source-over',opacity:1},stages.textGamma||1);for(const item of stages.post)paint(item.image,item.settings);
    const after=work.getContext('2d').getImageData(0,0,this.width,this.height),k=Math.max(0,Math.min(1,layer.opacity??1));
    for(let i=0;i<after.data.length;i+=4){const weight=k*(stages.hidingCoverage?stages.hidingCoverage[i+3]/255:1),a=before.data[i+3]/255*(1-weight),b=after.data[i+3]/255*weight,alpha=a+b;for(let c=0;c<3;c++)after.data[i+c]=alpha?(before.data[i+c]*a+after.data[i+c]*b)/alpha:0;after.data[i+3]=alpha*255;}
    destination.getContext('2d').putImageData(after,0,0);return true;
  }
  compositeTransform(layer){
    if(!layer||!this.layers.includes(layer))return this.composite();
    const above=[];let seen=false;
    for(const item of this.layers){if(item===layer){seen=true;continue;}if(!seen||(item.parentId||null)!==(layer.parentId||null)||item.visible===false)continue;above.push(item);item.visible=false;}
    let canvas;try{canvas=this.composite();}finally{for(const item of above)item.visible=true;}
    const context=canvas.getContext('2d');
    for(const item of above){context.save();context.globalAlpha=item.opacity??1;context.globalCompositeOperation=item.blend&&item.blend!=='pass-through'?item.blend:'source-over';if(item.kind==='group')context.drawImage(this.composite(item.id),item.x||0,item.y||0);else if(item.kind!=='adjustment'&&item.canvas){const rendered=this.renderLayer(item);context.drawImage(rendered.canvas,(item.x||0)+(rendered.offsetX||0),(item.y||0)+(rendered.offsetY||0));}context.restore();}
    return canvas;
  }
  composite(parentId=null,ancestors=new Set(),backdrop=null,scope=null) {
    const here=scope||{root:parentId==null,isolated:false},floor=backdrop||null;
    if(ancestors.has(parentId))throw Error('A layer group contains a circular reference.');const visited=new Set(ancestors);visited.add(parentId);
    const canvas = surface(this.width, this.height), context = canvas.getContext('2d');
    if(backdrop)context.drawImage(backdrop,0,0);
    let clippingBase=null,clippingLayer=null;const siblings=this.layers.filter(item=>(item.parentId||null)===parentId),consumed=new Set();
    for (const layer of siblings) {
      if(consumed.has(layer.id))continue;
      if (!layer.visible) {if(!layer.clipping)clippingBase=surface(this.width,this.height);continue;}
      const following=siblings.slice(siblings.indexOf(layer)+1),clipped=[];for(const next of following){if(!next.clipping)break;clipped.push(next);}
      if(layer.kind==='adjustment'&&layer.adjustment){
        if(layer.clipping&&!clippingBase)continue;
        const knockout=layer.knockout===1||layer.knockout===2,needsBlend=layer.clipping||knockout||blendIfActive(layer.blendIf)||channelWeights(layer.excludedChannels,this.psdMode==='duotone'),blendBefore=needsBlend?context.getImageData(0,0,this.width,this.height):null;
        let shape=null,knocked=null;if(knockout){shape=this.shapelessKnockout(layer,canvas);const target=this.knockoutTarget(layer,here,floor);knocked=new ImageData(new Uint8ClampedArray(blendBefore.data),this.width,this.height);knockoutBackdrop(knocked,target?.getContext('2d').getImageData(0,0,this.width,this.height)||null,shape);context.putImageData(knocked,0,0);}
        const original=context.getImageData(0,0,this.width,this.height);
        let changed=new ImageData(new Uint8ClampedArray(original.data),this.width,this.height);
        adjustPixels(changed,layer.adjustment.name,layer.adjustment.amount);
        if(!layer.clipping&&clipped.some(item=>item.visible)){
          const adjusted=surface(this.width,this.height);adjusted.getContext('2d').putImageData(changed,0,0);const floor=copyCanvas(adjusted);for(const follower of clipped){if(follower.visible)this.blendFollower(adjusted,follower,floor,visited);consumed.add(follower.id);}changed=adjusted.getContext('2d').getImageData(0,0,this.width,this.height);
        }
        this.blendAdjustmentPixels(original,changed,layer);
        if(knockout)knockoutOpacity(original,blendBefore,knocked,layer.opacity??1,shape);context.putImageData(original,0,0);this.finishBlendOptions(context,blendBefore,null,layer);if(layer.clipping){const after=context.getImageData(0,0,this.width,this.height);clipInside(blendBefore,after,clippingBase.getContext('2d').getImageData(0,0,this.width,this.height),clippingLayer?.blendClipped===false?clippingLayer.opacity??1:1);context.putImageData(after,0,0);}continue;
      }
      const passFollowers=layer.blendClipped===false?[]:clipped;
      if(this.passThroughReady(layer,passFollowers)){
        if(layer.knockout===1||layer.knockout===2){
          const before=context.getImageData(0,0,this.width,this.height),shape=layer.transparencyShapes===false?this.shapelessKnockout(layer,canvas):this.contentKnockout(layer,canvas),target=this.knockoutTarget(layer,here,floor),knocked=new ImageData(new Uint8ClampedArray(before.data),this.width,this.height);
          knockoutBackdrop(knocked,target?.getContext('2d').getImageData(0,0,this.width,this.height)||null,shape);context.putImageData(knocked,0,0);this.compositePassThrough(layer,passFollowers,canvas,context,visited,layer.clipping?clippingBase:null,here,true);
          const after=context.getImageData(0,0,this.width,this.height);knockoutOpacity(after,before,knocked,layer.opacity??1,shape);context.putImageData(after,0,0);
          this.finishBlendOptions(context,before,this.layerGroupOwnPixels(layer),layer);
        }else this.compositePassThrough(layer,passFollowers,canvas,context,visited,layer.clipping?clippingBase:null,here);
        for(const next of passFollowers)consumed.add(next.id);clippingBase=surface(this.width,this.height);clippingBase.getContext('2d').putImageData(this.layerGroupOwnPixels(layer),0,0);clippingLayer=layer;continue;
      }
      const pixels=surface(this.width,this.height),paint=pixels.getContext('2d');let layerRender=null,effectReplay=null;
      if(layer.kind==='group'){
        paint.drawImage(this.composite(layer.id,visited,null,{root:false,isolated:true}),layer.x,layer.y);this.paintArtboard(paint,layer);
        const hideMask=Boolean(layer.maskHidesEffects&&layer.mask&&!layer.maskDisabled),hideVector=Boolean(layer.vectorMaskHidesEffects&&layer.vectorMask?.enabled!==false&&layer.vectorMask?.path);
        if(!hideMask&&!hideVector&&this.usesCoverage(layer)){paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(layer,this.width,this.height),0,0);}
        else if(this.usesCoverage(layer))this.applySelectedCoverage(layer,pixels,!hideMask&&layer.mask&&!layer.maskDisabled,!hideVector&&layer.vectorMask?.enabled!==false&&layer.vectorMask?.path,0,0);
        const stageBackdrop=!layer.clipping&&!clipped.some(item=>item.visible)&&!layer.knockout?canvas:null,rendered=renderEffects(pixels,layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,undefined,layer.blend,{x:0,y:0},null,stageBackdrop);layerRender=rendered;if(rendered.canvas!==pixels){paint.globalCompositeOperation='copy';paint.drawImage(rendered.canvas,rendered.offsetX,rendered.offsetY);}
        if(hideMask||hideVector){if(rendered.stages){const hiding=surface(this.width,this.height),context=hiding.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,this.width,this.height);this.applySelectedCoverage(layer,hiding,hideMask,hideVector,0,0);rendered.stages.hidingCoverage=context.getImageData(0,0,this.width,this.height).data;}this.applySelectedCoverage(layer,rendered.canvas,hideMask,hideVector,rendered.offsetX||0,rendered.offsetY||0);if(rendered.canvas!==pixels){paint.globalCompositeOperation='copy';paint.drawImage(rendered.canvas,rendered.offsetX,rendered.offsetY);paint.globalCompositeOperation='source-over';}}
      }else {const effectBackdrop=!layer.clipping&&!clipped.some(item=>item.visible)&&!layer.knockout?canvas:null,rendered=this.renderLayer(layer,effectBackdrop);layerRender=rendered;paint.drawImage(rendered.canvas,layer.x+rendered.offsetX,layer.y+rendered.offsetY);}
      const hasBaseEffects=Object.values(layer.effects||{}).some(effect=>effect?.enabled),groupedClips=!layer.clipping&&layer.blendClipped!==false&&clipped.some(item=>item.visible);
      if(groupedClips){
        const hidePixel=hasBaseEffects&&Boolean(layer.maskHidesEffects&&layer.mask&&!layer.maskDisabled),hideVector=hasBaseEffects&&Boolean(layer.vectorMaskHidesEffects&&layer.vectorMask?.path&&layer.vectorMask.enabled!==false),savedPixel=layer.mask,savedVector=layer.vectorMask;
        const sourcePixels=(source=layer.canvas)=>{if(hidePixel)layer.mask=null;if(hideVector)layer.vectorMask=null;try{return this.layerPixels({...layer,canvas:source});}finally{layer.mask=savedPixel;layer.vectorMask=savedVector;}};
        const grouped=surface(this.width,this.height),groupPaint=grouped.getContext('2d'),splitShape=layer.shape&&(layer.shape.strokeEnabled||layer.shape.type==='line');let vectorStroke=null,vectorFill=null;
        if(splitShape){const fill=surface(layer.canvas.width,layer.canvas.height);if(layer.shape.type!=='line')renderShape(fill,{...layer.shape,strokeEnabled:false});vectorFill=fill;vectorStroke=surface(layer.canvas.width,layer.canvas.height);renderShape(vectorStroke,{...layer.shape,fillEnabled:false});groupPaint.drawImage(fill,layer.x,layer.y);}
        else if(layer.kind==='group'){groupPaint.drawImage(this.composite(layer.id,visited,null,{root:false,isolated:true}),layer.x,layer.y);this.paintArtboard(groupPaint,layer);this.applySelectedCoverage(layer,grouped,!hidePixel&&savedPixel&&!layer.maskDisabled,!hideVector&&savedVector?.path&&savedVector.enabled!==false,0,0);}
        else groupPaint.drawImage(sourcePixels(),layer.x,layer.y);
        const floor=copyCanvas(grouped);for(const follower of clipped){if(follower.visible)this.blendFollower(grouped,follower,floor,visited);consumed.add(follower.id);}
        if(vectorStroke&&!hasBaseEffects){groupPaint.drawImage(vectorStroke,layer.x,layer.y);if(this.usesCoverage(layer)){groupPaint.globalCompositeOperation='destination-in';groupPaint.drawImage(this.coverageMask(layer,this.width,this.height),0,0);groupPaint.globalCompositeOperation='source-over';}}
        if(hasBaseEffects&&layer.kind==='group'){effectReplay=backdrop=>renderEffects(grouped,layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,floor,layer.blend,{x:0,y:0},null,backdrop);const rendered=effectReplay(layer.knockout?null:canvas);layerRender=rendered;paint.clearRect(0,0,this.width,this.height);paint.drawImage(rendered.canvas,rendered.offsetX,rendered.offsetY);}
        else if(hasBaseEffects){
          const shape=sourcePixels(),content=copyCanvas(vectorFill||shape),local=content.getContext('2d');local.save();local.beginPath();local.rect(-layer.x,-layer.y,this.width,this.height);local.clip();local.globalCompositeOperation='copy';local.drawImage(grouped,-layer.x,-layer.y);local.restore();
          if(vectorStroke){this.applySelectedCoverage(layer,content,!hidePixel&&savedPixel&&!layer.maskDisabled,!hideVector&&savedVector?.path&&savedVector.enabled!==false,layer.x,layer.y);vectorStroke=sourcePixels(vectorStroke);}
          effectReplay=backdrop=>renderEffects(content,layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,shape,layer.blend,{x:layer.x,y:layer.y},vectorStroke,backdrop,layer.text?getTextGamma():1);const rendered=effectReplay(layer.knockout?null:canvas);layerRender=rendered;paint.clearRect(0,0,this.width,this.height);paint.drawImage(rendered.canvas,layer.x+rendered.offsetX,layer.y+rendered.offsetY);
        }else{paint.globalCompositeOperation='copy';paint.globalAlpha=layer.fillOpacity??1;paint.drawImage(grouped,0,0);paint.globalAlpha=1;paint.globalCompositeOperation='source-over';}
        if(hidePixel||hideVector){this.applySelectedCoverage(layer,pixels,hidePixel,hideVector,0,0);if(layerRender?.stages){const hiding=surface(this.width,this.height),context=hiding.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,this.width,this.height);this.applySelectedCoverage(layer,hiding,hidePixel,hideVector,0,0);layerRender.stages.hidingCoverage=context.getImageData(0,0,this.width,this.height).data;}}
      }
      const individual=layer.clipping&&clippingLayer?.blendClipped===false&&clippingLayer.kind!=='adjustment';
      if(layer.clipping){if(!clippingBase)continue;if(!individual){paint.globalCompositeOperation='destination-in';paint.drawImage(clippingBase,0,0);}}else{clippingBase=pixels;clippingLayer=layer;}
      const knockout=layer.knockout===1||layer.knockout===2,needsBlend=knockout||individual||blendIfActive(layer.blendIf)||channelWeights(layer.excludedChannels,this.psdMode==='duotone'),blendBefore=needsBlend?context.getImageData(0,0,this.width,this.height):null;
      let knockShape=null,knocked=null;if(knockout){knockShape=layer.transparencyShapes===false?this.shapelessKnockout(layer,pixels):this.contentKnockout(layer,pixels);const target=this.knockoutTarget(layer,here,floor),dest=context.getImageData(0,0,this.width,this.height);knockoutBackdrop(dest,target?.getContext('2d').getImageData(0,0,this.width,this.height)||null,knockShape);context.putImageData(dest,0,0);if((layer.opacity??1)<1)knocked=context.getImageData(0,0,this.width,this.height);}
      if(hasBaseEffects&&(individual||knockout&&!layer.clipping&&!clipped.some(item=>item.visible)))layerRender=layer.kind==='group'?this.renderGroupEffects(layer,visited,canvas):this.renderLayer(layer,canvas);
      if(knockout&&groupedClips&&effectReplay){const hidingCoverage=layerRender?.stages?.hidingCoverage;layerRender=effectReplay(canvas);if(hidingCoverage&&layerRender.stages)layerRender.stages.hidingCoverage=hidingCoverage;}
      const staged=layerRender?.stages&&(layer.blend==='source-over'||layer.blend==='dissolve'||layerRender.stages.premerged||layer.blendInterior===true)&&(individual||!layer.clipping&&(groupedClips||!clipped.some(item=>item.visible)))&&(!knockout||individual||effectReplay||!clipped.some(item=>item.visible))&&this.compositeEffectStages(canvas,layer,layerRender);
      if(staged){}else if(layer.text&&layer.blend!=='dissolve')compositeTextGamma(canvas,pixels,layer.blend,layer.opacity??1);else if(customBlends.has(layer.blend)){let seed=0;for(const character of layer.id)seed=Math.imul(seed,31)+character.charCodeAt(0)|0;compositeCustom(canvas,pixels,layer.blend,layer.opacity,seed);}
      else{context.globalAlpha = layer.opacity;context.globalCompositeOperation=layer.blend;context.drawImage(pixels,0,0);}context.globalAlpha=1;context.globalCompositeOperation='source-over';
      if(knockout&&knockShape){const after=context.getImageData(0,0,this.width,this.height);knockoutOpacity(after,blendBefore,knocked,layer.opacity??1,knockShape);context.putImageData(after,0,0);}
      this.finishBlendOptions(context,blendBefore,pixels.getContext('2d').getImageData(0,0,this.width,this.height),layer);
      if(individual&&blendBefore){const after=context.getImageData(0,0,this.width,this.height);clipInside(blendBefore,after,clippingBase.getContext('2d').getImageData(0,0,this.width,this.height),clippingLayer.opacity??1);context.putImageData(after,0,0);}
    }
    return canvas;
  }
  compositeWorld(x,y,w,h){const canvas=surface(Math.max(1,w),Math.max(1,h));this._paintWorld(canvas.getContext('2d'),null,x,y,canvas.width,canvas.height);return canvas;}
  _paintWorld(ctx,parentId,x,y,w,h){for(const layer of this.layers.filter(item=>(item.parentId||null)===parentId)){if(layer.visible===false)continue;if(layer.kind==='group'&&layer.passThrough!==false&&(layer.blend==='pass-through'||layer.blend==='source-over'&&(layer.opacity??1)===1&&!this.usesCoverage(layer))){this._paintWorld(ctx,layer.id,x,y,w,h);continue;}const local=surface(w,h),paint=local.getContext('2d');if(layer.kind==='group'){this._paintWorld(paint,layer.id,x,y,w,h);if(this.usesCoverage(layer)){paint.globalCompositeOperation='destination-in';paint.drawImage(this.coverageMask(layer,w,h,x,y),0,0);paint.globalCompositeOperation='source-over';}}else if(layer.kind==='adjustment'&&layer.adjustment){const image=ctx.getImageData(0,0,w,h);adjustPixels(image,layer.adjustment.name,layer.adjustment.amount);ctx.putImageData(image,0,0);continue;}else if(layer.canvas){const rendered=this.renderLayer(layer);paint.drawImage(rendered.canvas,(layer.x||0)+(rendered.offsetX||0)-x,(layer.y||0)+(rendered.offsetY||0)-y);}ctx.save();ctx.globalAlpha=layer.opacity??1;ctx.globalCompositeOperation=layer.blend&&layer.blend!=='pass-through'?layer.blend:'source-over';ctx.drawImage(local,0,0);ctx.restore();}}
  clip(context, layer = this.active) {
    const s = this.selection; if (!s || !layer) return;
    context.beginPath();
    if(s.kind==='alpha'){context.rect(-layer.x,-layer.y,this.width,this.height);context.clip();return;}
    if (s.inverse) context.rect(-layer.x, -layer.y, this.width, this.height);
    if(s.kind==='mask')traceSelectionRuns(context,s,-layer.x,-layer.y);
    else if (s.kind === 'ellipse') {context.moveTo(s.x-layer.x+s.w,s.y-layer.y+s.h/2);context.ellipse(s.x - layer.x + s.w / 2, s.y - layer.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);}
    else if (s.kind === 'path') {const outer=s.inverse?{x:-layer.x,y:-layer.y,w:this.width,h:this.height}:null;tracePath(context,s.path,-layer.x,-layer.y);if(outer)context.rect(outer.x,outer.y,outer.w,outer.h);}
    else if (s.kind === 'lasso') {s.points.forEach((p,index)=>index?context.lineTo(p.x-layer.x,p.y-layer.y):context.moveTo(p.x-layer.x,p.y-layer.y));context.closePath();}
    else context.rect(s.x - layer.x, s.y - layer.y, s.w, s.h);
    context.clip('evenodd');
  }
  selectionPixels(){
    if(this.selection?.kind==='alpha'){const output=new Uint8Array(this.width*this.height);for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)output[y*this.width+x]=selectionWeight(this.selection,x,y)>0?1:0;return output;}
    const canvas=surface(this.width,this.height),ctx=canvas.getContext('2d');this.clip(ctx,{x:0,y:0});ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);
    const {data}=ctx.getImageData(0,0,this.width,this.height),pixels=new Uint8Array(this.width*this.height);for(let i=0;i<pixels.length;i++)pixels[i]=data[i*4+3]>127?1:0;return pixels;
  }
  selectColor(x,y,tolerance=32,contiguous=true,operation='replace'){
    const next=colorSelection(this.composite().getContext('2d').getImageData(0,0,this.width,this.height),x,y,tolerance,contiguous);
    this.setSelection(next,operation);
  }
  selectionCoverage(){if(this.selection?.kind==='alpha'){const data=new Uint8ClampedArray(this.width*this.height);for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)data[y*this.width+x]=selectionWeight(this.selection,x,y)*255;return data;}const canvas=surface(this.width,this.height),ctx=canvas.getContext('2d');this.clip(ctx,{x:0,y:0});ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);const {data}=ctx.getImageData(0,0,this.width,this.height),alpha=new Uint8ClampedArray(this.width*this.height);for(let i=0;i<alpha.length;i++)alpha[i]=data[i*4+3];return alpha;}
  modifySelection(mode,amount,settings={}){
    if(!this.selection)return;const output=modifyCoverage(this.selectionCoverage(),this.width,this.height,mode,{canvasBounds:false,...settings,amount});
    this.checkpoint('Modify Selection');this.previousSelection=structuredClone(this.selection);this.selection=alphaSelection(output,this.width,this.height);this.dispatchEvent(new Event('change'));
  }
  featherSelection(radius,record=true,settings={}){
    if(!this.selection||!(radius>0))return;const output=modifyCoverage(this.selectionCoverage(),this.width,this.height,'feather',{canvasBounds:false,...settings,amount:radius});
    if(record)this.checkpoint('Feather Selection');this.selection=alphaSelection(output,this.width,this.height);this.dispatchEvent(new Event('change'));
  }
  compositeSample(mode){const hidden=[];for(const layer of this.layers){if(layer.kind==='adjustment'&&layer.visible!==false){layer.visible=false;hidden.push(layer);}}try{return mode==='currentAndBelow'?this.compositeThrough():this.composite();}finally{for(const layer of hidden)layer.visible=true;}}
  compositeThrough(layer=this.active){const canvas=surface(this.width,this.height),ctx=canvas.getContext('2d'),stop=Math.max(0,this.layers.indexOf(layer));for(let i=0;i<=stop;i++){const item=this.layers[i];if(item.visible===false||item.parentId)continue;if(item.kind==='group')ctx.drawImage(this.composite(item.id),item.x||0,item.y||0);else if(item.canvas&&item.kind!=='adjustment')ctx.drawImage(item.canvas,item.x||0,item.y||0);if(item===layer)break;}if(layer?.parentId&&layer.canvas)ctx.drawImage(layer.canvas,layer.x||0,layer.y||0);return canvas;}
  beginPixelEdit(canvas){return this.selection?.kind==='alpha'||canvas===this.active?.canvas&&this.isAlphaLocked()?copyCanvas(canvas):null;}
  finishPixelEdit(canvas,before,layer=this.active){
    const alphaLock=canvas===this.active?.canvas&&this.isAlphaLocked();if(!before||this.selection?.kind!=='alpha'&&!alphaLock)return;const ctx=canvas.getContext('2d'),original=before.getContext('2d').getImageData(0,0,before.width,before.height),edited=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4,w=this.selection?.kind==='alpha'?selectionWeight(this.selection,x+(layer?.x||0),y+(layer?.y||0)):1,oa=original.data[i+3]/255,ea=edited.data[i+3]/255,a=oa*(1-w)+ea*w;for(let c=0;c<3;c++)edited.data[i+c]=a?(original.data[i+c]*oa*(1-w)+edited.data[i+c]*ea*w)/a:alphaLock?original.data[i+c]:0;edited.data[i+3]=(alphaLock?oa:a)*255;}ctx.putImageData(edited,0,0);
  }
  editPixels(canvas,paint,layer=this.active){const origin=layer?.mask===canvas?this.maskOrigin(layer):layer,before=this.beginPixelEdit(canvas),ctx=canvas.getContext('2d');ctx.save();this.clip(ctx,origin);paint(ctx);ctx.restore();this.finishPixelEdit(canvas,before,origin);}
  applyTypeMask(canvas,originX,originY,operation='replace'){
    const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),coverage=placeCoverage(image.data,canvas.width,canvas.height,Math.round(originX),Math.round(originY),this.width,this.height),next=alphaSelection(coverage,this.width,this.height);
    const previous=this.selection;this.checkpoint('Type Mask');if(previous)this.previousSelection=structuredClone(previous);
    if(operation==='replace'||!previous){this.selection=next;this.dispatchEvent(new Event('change'));this.changed();return;}
    if(!next){this.dispatchEvent(new Event('change'));this.changed();return;}
    const a=this.selectionCoverage();this.selection=next;const b=next?this.selectionCoverage():new Uint8ClampedArray(this.width*this.height);for(let i=0;i<a.length;i++)a[i]=operation==='subtract'?Math.max(0,a[i]-b[i]):operation==='intersect'?Math.min(a[i],b[i]):Math.max(a[i],b[i]);this.selection=alphaSelection(a,this.width,this.height);this.dispatchEvent(new Event('change'));this.changed();
  }
  setSelection(next,operation='replace'){
    const previous=this.selection;this.checkpoint('Selection');if(previous)this.previousSelection=structuredClone(previous);if(operation==='replace'){this.selection=next;this.dispatchEvent(new Event('change'));return;}
    if(previous?.kind==='alpha'||next?.kind==='alpha'){const a=previous?this.selectionCoverage():new Uint8ClampedArray(this.width*this.height);this.selection=next;const b=next?this.selectionCoverage():new Uint8ClampedArray(this.width*this.height);for(let i=0;i<a.length;i++)a[i]=operation==='subtract'?Math.max(0,a[i]-b[i]):operation==='intersect'?Math.min(a[i],b[i]):Math.max(a[i],b[i]);this.selection=alphaSelection(a,this.width,this.height);this.dispatchEvent(new Event('change'));return;}
    const a=previous?selectionFromPixels(this.selectionPixels(),this.width,this.height):null;this.selection=next;
    const b=next?selectionFromPixels(this.selectionPixels(),this.width,this.height):null;this.selection=combineSelections(a,b,this.width,this.height,operation);this.dispatchEvent(new Event('change'));
  }
  preparePixelMove(){
    const layer=this.active;if(!layer||this.isLocked(layer)||!this.selection||layer.kind==='smart')return null;
    if(!(layer.editMask&&layer.mask)&&this.isAlphaLocked(layer))throw Error('Unlock transparent pixels before moving selected pixels.');
    const maskTarget=Boolean(layer.editMask&&layer.mask),source=maskTarget?layer.mask:layer.canvas,base=copyCanvas(source),floating=surface(source.width,source.height),origin=maskTarget?this.maskOrigin(layer):layer;this.editPixels(floating,ctx=>ctx.drawImage(source,0,0),origin);
    this.editPixels(base,ctx=>ctx.clearRect(0,0,base.width,base.height),origin);return{base,floating,selection:structuredClone(this.selection),maskTarget,origin:{x:origin.x,y:origin.y},maskOrigin:layer.mask?this.maskOrigin(layer):null};
  }
  moveSelectedPixels(move,dx,dy){
    const layer=this.active;if(!layer)return;const left=Math.min(0,dx),top=Math.min(0,dy),width=Math.max(move.base.width,dx+move.floating.width)-left,height=Math.max(move.base.height,dy+move.floating.height)-top;
    if(width>32767||height>32767||width*height>64000000)throw Error('Moving selected pixels exceeds the image size limit.');const next=surface(width,height),ctx=next.getContext('2d');ctx.drawImage(move.base,-left,-top);ctx.drawImage(move.floating,dx-left,dy-top);
    if(move.maskTarget){layer.mask=next;layer.maskOffsetX=move.origin.x+left-layer.x;layer.maskOffsetY=move.origin.y+top-layer.y;}
    else{layer.canvas=next;layer.x=move.origin.x+left;layer.y=move.origin.y+top;layer.text=null;layer.shape=null;if(move.maskOrigin){layer.maskOffsetX=move.maskOrigin.x-layer.x;layer.maskOffsetY=move.maskOrigin.y-layer.y;}}
    this.selection=offsetSelection(move.selection,dx,dy);this.changed();
  }
  saveSelectionChannel(name='Alpha Channel'){
    this.checkpoint('Save Selection');const canvas=this.quickMask?copyCanvas(this.quickMask.canvas):surface(this.width,this.height);if(!this.quickMask)this.editPixels(canvas,ctx=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);},{x:0,y:0});
    const channel={id:crypto.randomUUID(),name,canvas};this.channels.push(channel);this.changed();return channel;
  }
  loadSelectionChannel(id){const channel=this.channels.find(item=>item.id===id);if(!channel)return;const {data}=channel.canvas.getContext('2d').getImageData(0,0,this.width,this.height),mask=new Uint8Array(this.width*this.height);for(let i=0;i<mask.length;i++)mask[i]=data[i*4+3];this.setSelection(alphaSelection(mask,this.width,this.height));}
  toggleQuickMask(){
    this.checkpoint('Quick Mask');if(this.quickMask){const {data}=this.quickMask.canvas.getContext('2d').getImageData(0,0,this.width,this.height),alpha=new Uint8ClampedArray(this.width*this.height);for(let i=0;i<alpha.length;i++)alpha[i]=data[i*4+3];this.selection=alphaSelection(alpha,this.width,this.height);this.quickMask=null;}
    else{const canvas=surface(this.width,this.height);this.editPixels(canvas,ctx=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);},{x:0,y:0});this.quickMask={id:'quick-mask',name:'Quick Mask',canvas};this.selection=null;this.activeChannelId='RGB';}this.changed();
  }
  flattenAllLayerEffects(){
    const prepared=[];for(const layer of this.layers){if(['group','adjustment'].includes(layer.kind)||!Object.values(layer.effects||{}).some(effect=>effect?.enabled))continue;
      const left=Math.floor(Math.min(0,layer.x)-256),top=Math.floor(Math.min(0,layer.y)-256),right=Math.ceil(Math.max(this.width,layer.x+layer.canvas.width)+256),bottom=Math.ceil(Math.max(this.height,layer.y+layer.canvas.height)+256);
      if(right-left>32767||bottom-top>32767||(right-left)*(bottom-top)>64000000)throw Error('Baking effects exceeds the image size limit.');
      const rendered=this.renderLayerEffects({...layer,mask:null,vectorMask:null,opacity:1,blend:'source-over',visible:true,clipping:false}),canvas=surface(right-left,bottom-top);canvas.getContext('2d').drawImage(rendered.canvas,layer.x+rendered.offsetX-left,layer.y+rendered.offsetY-top);prepared.push({layer,canvas,x:left,y:top,maskOrigin:layer.mask?this.maskOrigin(layer):null});
    }
    this.checkpoint('Flatten All Layer Effects');for(const {layer,canvas,x,y,maskOrigin}of prepared){layer.canvas=canvas;layer.x=x;layer.y=y;layer.effects=null;layer.fillOpacity=1;layer.kind=null;layer.text=null;layer.shape=null;layer.fill=null;for(const key of ['smartSource','smartOperations','smartDocument','smartPsd','smartFile','smartFeid','smartImportQuad','smartFilterMask','smartLink','smartOrigin','smartContentsId'])layer[key]=null;if(maskOrigin){layer.maskOffsetX=maskOrigin.x-x;layer.maskOffsetY=maskOrigin.y-y;}}
    this.changed();return prepared.length;
  }
  flattenAllMasks(){
    const layers=this.layers.filter(layer=>!layer.kind&&!layer.text&&!layer.shape&&((layer.mask&&!layer.maskDisabled)||layer.vectorMask));
    const prepared=layers.map(layer=>({layer,canvas:copyCanvas(this.layerPixels(layer))}));this.checkpoint('Flatten All Masks');
    for(const {layer,canvas}of prepared){layer.canvas=canvas;layer.mask=null;layer.vectorMask=null;layer.editMask=false;layer.maskOffsetX=layer.maskOffsetY=0;layer.maskDisabled=false;}
    this.changed();return prepared.length;
  }
  layerPixels(layer) {
    if (!this.usesCoverage(layer)) return layer.canvas;
    const output=copyCanvas(layer.canvas),context=output.getContext('2d');
    context.globalCompositeOperation='destination-in';context.drawImage(this.coverageMask(layer,layer.canvas.width,layer.canvas.height,layer.x,layer.y),0,0);return output;
  }
  applySelectedCoverage(layer,canvas,mask,vector,originX=0,originY=0){
    const savedMask=layer.mask,savedVector=layer.vectorMask;layer.mask=mask?savedMask:null;layer.vectorMask=vector?savedVector:null;
    try{if(!this.usesCoverage(layer))return;const context=canvas.getContext('2d');context.globalCompositeOperation='destination-in';context.drawImage(this.coverageMask(layer,canvas.width,canvas.height,originX,originY),0,0);context.globalCompositeOperation='source-over';}
    finally{layer.mask=savedMask;layer.vectorMask=savedVector;}
  }
  renderLayerEffects(layer,backdrop=null){
    const shape=layer.shape,split=shape&&(shape.strokeEnabled||shape.type==='line')&&Object.values(layer.effects||{}).some(effect=>effect?.enabled);
    if(!split)return renderEffects(this.layerPixels(layer),layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,undefined,layer.blend,{x:layer.x,y:layer.y},null,backdrop,layer.text?getTextGamma():1);
    const fill=surface(layer.canvas.width,layer.canvas.height),stroke=surface(layer.canvas.width,layer.canvas.height);if(shape.type!=='line')renderShape(fill,{...shape,strokeEnabled:false});renderShape(stroke,{...shape,fillEnabled:false});
    return renderEffects(this.layerPixels({...layer,canvas:fill}),layer.effects,layer.fillOpacity??1,layer.transparencyShapes!==false,layer.blendInterior===true,this.layerPixels(layer),layer.blend,{x:layer.x,y:layer.y},this.layerPixels({...layer,canvas:stroke}),backdrop,layer.text?getTextGamma():1);
  }
  renderLayer(layer,backdrop=null){
    const hideMask=Boolean(layer.maskHidesEffects&&layer.mask&&!layer.maskDisabled),hideVector=Boolean(layer.vectorMaskHidesEffects&&layer.vectorMask?.enabled!==false&&layer.vectorMask?.path);
    if(!hideMask&&!hideVector)return this.renderLayerEffects(layer,backdrop);
    const savedMask=layer.mask,savedVector=layer.vectorMask;if(hideMask)layer.mask=null;if(hideVector)layer.vectorMask=null;
    let rendered;try{rendered=this.renderLayerEffects(layer,backdrop);}finally{layer.mask=savedMask;layer.vectorMask=savedVector;}
    const output=copyCanvas(rendered.canvas);this.applySelectedCoverage(layer,output,hideMask,hideVector,layer.x+(rendered.offsetX||0),layer.y+(rendered.offsetY||0));
    if(rendered.stages){const hiding=surface(this.width,this.height),paint=hiding.getContext('2d');paint.fillStyle='#fff';paint.fillRect(0,0,this.width,this.height);this.applySelectedCoverage(layer,hiding,hideMask,hideVector,0,0);rendered.stages.hidingCoverage=paint.getImageData(0,0,this.width,this.height).data;}
    return {canvas:output,offsetX:rendered.offsetX||0,offsetY:rendered.offsetY||0,...(rendered.stages?{stages:rendered.stages}:{})};
  }
  addMask() {
    const layer=this.active;if(!layer||this.isLocked(layer))return;if(layer.mask)throw Error('This layer already has a mask. Edit or delete the existing mask first.');
    this.checkpoint('Add Layer Mask');layer.maskDisabled=false;layer.maskDensity=1;layer.maskFeather=0;layer.maskDefault=0;layer.mask=surface(layer.canvas.width,layer.canvas.height);layer.maskOffsetX=layer.maskOffsetY=0;
    this.editPixels(layer.mask,context=>{context.fillStyle='#fff';context.fillRect(0,0,layer.mask.width,layer.mask.height);});this.changed();
  }
  removeMask(apply=false) {
    const layer=this.active;if(!layer?.mask||this.isLocked(layer))return;
    if(apply&&layer.kind==='adjustment')throw Error('Use Flatten Image to rasterize a masked adjustment.');
    if(apply&&layer.kind==='smart')throw Error('Rasterize the smart object before applying its mask.');
    if(apply&&layer.kind==='group')this.mergeGroup();
    this.checkpoint(apply?'Apply Layer Mask':'Delete Layer Mask');
    if(apply){const vector=layer.vectorMask;layer.vectorMask=null;try{layer.canvas=this.layerPixels(layer);}finally{layer.vectorMask=vector;}layer.text=null;layer.shape=null;}layer.mask=null;layer.maskDisabled=false;layer.editMask=false;this.changed();
  }
  rasterizeText() {
    const layer=this.active;if(!layer?.text||this.isLocked(layer))return;this.checkpoint('Rasterize Type');layer.text=null;layer.shape=null;this.changed();
  }
  fill(color) {
    const layer = this.paintLayer; if (!layer || this.isLocked(layer)) return;
    if(layer.editMask&&layer.mask){this.checkpoint('Fill Layer Mask');this.editPixels(layer.mask,ctx=>{ctx.clearRect(0,0,layer.mask.width,layer.mask.height);ctx.fillStyle=`rgba(255,255,255,${colorLuminance(color)})`;ctx.fillRect(0,0,layer.mask.width,layer.mask.height);},layer);this.changed();return;}
    if(['adjustment','group'].includes(layer.kind))throw Error('Select a raster layer for pixel editing.');
    this.checkpoint('Fill');this.editPixels(layer.canvas,context=>{context.fillStyle=color;context.fillRect(0,0,layer.canvas.width,layer.canvas.height);});layer.text=null;layer.shape=null;this.changed();
  }
  clear() {
    const layer = this.paintLayer; if (!layer || this.isLocked(layer)) return;
    if(layer.editMask&&layer.mask){this.checkpoint('Clear Layer Mask');this.editPixels(layer.mask,ctx=>ctx.clearRect(0,0,layer.mask.width,layer.mask.height),layer);this.changed();return;}
    if(['adjustment','group'].includes(layer.kind))throw Error('Select a raster layer for pixel editing.');
    this.checkpoint('Clear');this.editPixels(layer.canvas,context=>context.clearRect(0,0,layer.canvas.width,layer.canvas.height));layer.text=null;layer.shape=null;this.changed();
  }
  floodFill(x, y, color, tolerance = 32) {
    const layer = this.paintLayer; if (!layer || this.isLocked(layer)) return;
    const maskTarget=Boolean(layer.editMask&&layer.mask);if(['adjustment','group','smart'].includes(layer.kind)&&!maskTarget)throw Error('Select a raster layer for pixel editing.');
    const origin=maskTarget?this.maskOrigin(layer):layer;x = Math.floor(x - origin.x); y = Math.floor(y - origin.y);
    const targetCanvas=maskTarget?layer.mask:layer.canvas,width=targetCanvas.width,height=targetCanvas.height,before=this.beginPixelEdit(targetCanvas);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const context=targetCanvas.getContext('2d');
    const image = context.getImageData(0, 0, width, height), pixels = image.data;
    const start = (y * width + x) * 4, target = [...pixels.slice(start, start + 4)];
    const swatch = surface(1,1), paint = swatch.getContext('2d');paint.fillStyle=maskTarget?'rgba(255,255,255,'+colorLuminance(color)+')':color;paint.fillRect(0,0,1,1);
    const fill = paint.getImageData(0,0,1,1).data;
    if (target.every((value,index)=>value === fill[index])) return;
    this.checkpoint('Paint Bucket');
    let selected=null;
    if(this.selection){const selectionCanvas=surface(width,height),selectionContext=selectionCanvas.getContext('2d');this.clip(selectionContext,origin);selectionContext.fillStyle='#fff';selectionContext.fillRect(0,0,width,height);selected=selectionContext.getImageData(0,0,width,height).data;}
    const visited = new Uint8Array(width * height), pending = [y * width + x];
    const matches = index => {
      if (index < 0 || index >= visited.length || visited[index]) return false;
      if(selected&&selected[index*4+3]===0)return false;
      return target[3]===0&&pixels[index*4+3]===0||target.every((value,c)=>Math.abs(pixels[index*4+c]-value)<=tolerance);
    };
    while(pending.length){const seed=pending.pop();if(!matches(seed))continue;
      const row=Math.floor(seed/width),sx=seed%width;let left=sx,right=sx;
      while(left>0&&matches(row*width+left-1))left--;
      while(right<width-1&&matches(row*width+right+1))right++;
      for(let cx=left;cx<=right;cx++){const index=row*width+cx;visited[index]=1;pixels.set(fill,index*4);
        if(row>0&&matches(index-width))pending.push(index-width);
        if(row<height-1&&matches(index+width))pending.push(index+width);
      }
    }
    context.putImageData(image,0,0);this.finishPixelEdit(targetCanvas,before,origin);if(!maskTarget){layer.text=null;layer.shape=null;}this.changed();
  }
  perspectiveCrop(corners,options={}){
    if(!Array.isArray(corners)||corners.length!==4||corners.some(p=>!Array.isArray(p)||p.length!==2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>1e7||Math.abs(p[1])>1e7))throw Error('corners must be four [x, y] points: top-left, top-right, bottom-right, bottom-left');
    const q=corners.map(p=>[p[0],p[1]]);
    if(!convexQuad(q))throw Error('the corners must form a convex quadrilateral at least 1 px in area, in order top-left, top-right, bottom-right, bottom-left');
    const interpolation=['nearest','bilinear','bicubic'].includes(options.interpolation)?options.interpolation:'bicubic';
    const size=outputSize(q,options.width,options.height);if(!size)throw Error('Choose dimensions up to 32,767 pixels per side and 64 million pixels.');
    const forward=quadToRect(q,size.width,size.height);if(!forward)throw Error('the corners don\'t define a perspective');
    const resolution=options.resolution==null?null:Number(options.resolution);if(resolution!=null&&(!Number.isFinite(resolution)||resolution<1||resolution>10000))throw Error('Choose a resolution between 1 and 10000 PPI.');
    const background=/^#[0-9a-f]{6}$/i.test(options.background)?options.background:'#ffffff';
    this.checkpoint('Perspective Crop');
    const bg=this.layers.find(layer=>!layer.parentId&&!layer.kind&&!layer.clipping&&layer.lockAlpha&&layer.lockPosition&&layer.visible!==false);
    const affine=nearestAffine(q,size.width,size.height);
    for(const layer of this.layers){
      if(layer.text)layer.text=null;if(layer.shape)layer.shape=null;if(layer.fill)layer.fill=null;
      if(layer.kind==='smart'){layer.kind=null;layer.smartLink=null;layer.smartContentsId=null;layer.smartSource=null;layer.smartOperations=null;layer.smartDocument=null;layer.smartPsd=null;layer.smartFile=null;layer.smartFeid=null;layer.smartImportQuad=null;layer.smartFilterMask=null;layer.smartFiltersEnabled=true;}
      const maskOrigin=layer.mask?this.maskOrigin(layer):null,placeX=layer.x,placeY=layer.y;
      if(layer.kind==='group'||layer.kind==='adjustment'){layer.canvas=surface(size.width,size.height);layer.x=0;layer.y=0;}
      else{const read=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),data=warpImage(read,placeX,placeY,forward,size.width,size.height,interpolation),canvas=surface(size.width,size.height);if(layer===bg){const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,size.width,size.height);const over=surface(size.width,size.height);over.getContext('2d').putImageData(new ImageData(data,size.width,size.height),0,0);ctx.drawImage(over,0,0);}else canvas.getContext('2d').putImageData(new ImageData(data,size.width,size.height),0,0);layer.canvas=canvas;layer.x=0;layer.y=0;}
      if(layer.mask){const read=layer.mask.getContext('2d').getImageData(0,0,layer.mask.width,layer.mask.height),data=warpImage(read,maskOrigin.x,maskOrigin.y,forward,size.width,size.height,interpolation),mask=surface(size.width,size.height);mask.getContext('2d').putImageData(new ImageData(data,size.width,size.height),0,0);layer.mask=mask;layer.maskOffsetX=0;layer.maskOffsetY=0;}
      if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>{const p=mapAffine(affine,x,y);return{x:p[0],y:p[1]};});
      if(layer.artboard){const b=layer.artboard,corners=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]].map(p=>mapAffine(affine,p[0],p[1])),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),x=Math.round(Math.min(...xs)),y=Math.round(Math.min(...ys));layer.artboard={...b,x,y,w:Math.max(1,Math.round(Math.max(...xs))-x),h:Math.max(1,Math.round(Math.max(...ys))-y)};}
    }
    for(const channel of [...this.channels,...(this.quickMask?[this.quickMask]:[])]){const read=channel.canvas.getContext('2d').getImageData(0,0,channel.canvas.width,channel.canvas.height),data=warpImage(read,0,0,forward,size.width,size.height,interpolation),canvas=surface(size.width,size.height);canvas.getContext('2d').putImageData(new ImageData(data,size.width,size.height),0,0);channel.canvas=canvas;}
    this.guides=this.guides.map(guide=>{const p=guide.axis==='vertical'?mapAffine(affine,guide.position,0):mapAffine(affine,0,guide.position);return{...guide,position:guide.axis==='vertical'?p[0]:p[1]};});
    this.paths.forEach(path=>transformPath(path,(x,y)=>{const p=mapAffine(affine,x,y);return{x:p[0],y:p[1]};}));
    this.notes=this.notes.map(note=>{const p=mapAffine(affine,note.x,note.y),a=mapAffine(affine,note.popup[0],note.popup[1]),b=mapAffine(affine,note.popup[2],note.popup[3]);return {...note,x:p[0],y:p[1],popup:[a[0],a[1],b[0],b[1]]};});
    this.width=size.width;this.height=size.height;this.selection=null;if(resolution!=null)this.resolution=resolution;this.changed();
  }
  addNote(fields){const color=noteColor(fields.color);if(!Number.isFinite(fields.x)||!Number.isFinite(fields.y)||!color)throw Error('Note coordinates must be finite.');this.checkpoint('New Note');const note=newNote(fields.x,fields.y,fields.author,color,fields.text);this.notes.push(note);this.changed();return note;}
  setNote(index,fields){const note=this.notes[index];if(!note)throw Error('That note does not exist.');let next={...note,popup:note.popup.slice()};if(fields.text!=null)next.text=String(fields.text);if(fields.author!=null)next.author=String(fields.author);if(fields.color!=null){const color=noteColor(fields.color);if(!color)throw Error('Choose a note color.');next.color=color;}if(fields.x!=null||fields.y!=null){const x=fields.x??note.x,y=fields.y??note.y;if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Note coordinates must be finite.');next=moveNote(next,x,y);if(next.popup.some(v=>!Number.isFinite(v)))throw Error('The move is too far.');}if(next.text===note.text&&next.author===note.author&&next.color===note.color&&next.x===note.x&&next.y===note.y)return;if(next.text!==note.text||next.author!==note.author)next.modified=newNote(0,0).modified;this.checkpoint(next.x!==note.x||next.y!==note.y?'Move Note':'Edit Note');this.notes[index]=next;this.changed();}
  deleteNote(index){if(!this.notes[index])throw Error('That note does not exist.');this.checkpoint('Delete Note');this.notes.splice(index,1);this.changed();}
  deleteAllNotes(){if(!this.notes.length)return;this.checkpoint('Delete All Notes');this.notes=[];this.changed();}
  addSlice(rect){const x=Math.max(0,rect.x),y=Math.max(0,rect.y),w=Math.min(this.width,rect.x+rect.w)-x,h=Math.min(this.height,rect.y+rect.h)-y;if(w<1||h<1)throw Error('the slice is outside the canvas');this.checkpoint('Slice');const id=this.slices.reduce((max,slice)=>Math.max(max,slice.id),0)+1;this.slices.push({id,x,y,w,h,name:''});this.changed();return id;}
  moveSlice(id,dx,dy){const slice=this.slices.find(item=>item.id===id);if(!slice||!dx&&!dy)return;const x=slice.x+dx,y=slice.y+dy,w=Math.min(this.width,x+slice.w)-Math.max(0,x),h=Math.min(this.height,y+slice.h)-Math.max(0,y);if(w<1||h<1)throw Error('slice is off the canvas');this.checkpoint('Slice Options');slice.x=x;slice.y=y;this.changed();}
  nextSliceId(){return this.slices.reduce((max,slice)=>Math.max(max,slice.id),0)+1;}
  userSlice(number){const found=resolveSlices(this.slices,this.width,this.height).find(slice=>slice.number===number);if(!found)throw Error('no such slice');if(found.id!=null)return found.id;const id=this.nextSliceId();this.slices.push({id,x:found.x,y:found.y,w:found.w,h:found.h,name:''});return id;}
  promoteSlice(number){const before=resolveSlices(this.slices,this.width,this.height).find(slice=>slice.number===number);if(before?.id!=null)return before.id;this.checkpoint('Promote to User Slice');const id=this.userSlice(number);this.changed();return id;}
  deleteSlice(id){if(!this.slices.some(slice=>slice.id===id))throw Error('no such slice');this.checkpoint('Delete Slice');this.slices=this.slices.filter(slice=>slice.id!==id);this.changed();}
  setSliceOptions(number,fields){const nextFields={};for(const key of ['name','url','target','alt','message','cellText'])if(key in fields)nextFields[key]=String(fields[key]??'').slice(0,200);if(fields.kind!=null&&!['image','noImage'].includes(fields.kind))throw Error('kind must be image or noImage');this.checkpoint('Slice Options');const id=this.userSlice(number),slice=this.slices.find(item=>item.id===id);Object.assign(slice,nextFields);if(fields.kind)slice.kind=fields.kind;if(fields.background!=null)slice.background=String(fields.background).slice(0,40);this.changed();return id;}
  divideSlice(number,down,across){down=Math.max(1,Math.min(1000,down|0));across=Math.max(1,Math.min(1000,across|0));if(down===1&&across===1)throw Error('give horizontal and/or vertical greater than 1');if(down*across>10000)throw Error(down+' x '+across+' parts is more than one division makes');const found=resolveSlices(this.slices,this.width,this.height).find(slice=>slice.number===number);if(!found)throw Error('no such slice');if(found.w<across||found.h<down)throw Error('the slice is too small to divide that many times');const parts=divideRect(found,down,across);this.checkpoint('Divide Slice');let id=found.id;if(id==null){id=this.nextSliceId();this.slices.push({id,x:found.x,y:found.y,w:found.w,h:found.h,name:''});}const src=this.slices.find(slice=>slice.id===id),pos=this.slices.indexOf(src);this.slices.splice(pos,1);let next=Math.max(id,...this.slices.map(slice=>slice.id),0)+1;const ids=[];parts.forEach((part,index)=>{const nid=index===0?id:next++;const base=index===0?{...src,id:nid,...part}:{id:nid,...part,name:''};ids.push(nid);this.slices.splice(pos+index,0,base);});this.changed();return ids;}
  slicesFromGuides(){const rects=guideSliceRects(this.width,this.height,this.guides);if(!rects)throw Error('the document has no guides inside the canvas');this.checkpoint('Slices From Guides');let id=1;this.slices=rects.map(rect=>({id:id++,x:rect.x,y:rect.y,w:rect.w,h:rect.h,name:''}));this.changed();return this.slices.length;}
  addFrame(rect,ellipse=false){if(!rect||![rect.x,rect.y,rect.w,rect.h].every(Number.isInteger)||rect.w<1||rect.h<1||rect.w>300000||rect.h>300000)throw Error('width and height must be 1..=300000');const box=frameMaskRect(rect,this.width,this.height);if(box.w>32767||box.h>32767||box.w*box.h>64000000)throw Error('The frame exceeds the image size limit.');const active=this.active,background=active&&!active.parentId&&!active.kind&&!active.clipping&&active.lockAlpha&&active.lockPosition&&active.visible!==false;let bounds=null;if(active?.canvas&&!background&&!active.locked&&!active.lockPosition&&active.kind!=='group'&&active.kind!=='adjustment'){if(active.text||active.shape||active.kind==='smart')bounds={x:active.x||0,y:active.y||0,w:active.canvas.width,h:active.canvas.height};else{const image=active.canvas.getContext('2d').getImageData(0,0,active.canvas.width,active.canvas.height).data;let left=active.canvas.width,top=active.canvas.height,right=-1,bottom=-1;for(let i=3;i<image.length;i+=4)if(image[i]){const p=(i-3)/4,x=p%active.canvas.width,y=Math.floor(p/active.canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}if(right>=left)bounds={x:(active.x||0)+left,y:(active.y||0)+top,w:right-left+1,h:bottom-top+1};}}const take=frameTakes(bounds?{...active,bounds}:null,rect,background)?active:null;if(take){let depth=1,parent=take.parentId;const seen=new Set([take.id]);while(parent){if(seen.has(parent)||++depth>=30)throw Error('Grouping would exceed the supported layer depth.');seen.add(parent);parent=this.layers.find(layer=>layer.id===parent)?.parentId;}}this.checkpoint('New Frame');const names=this.layers.filter(layer=>layer.kind==='group'&&/^Frame \d+$/.test(layer.name)).map(layer=>layer.name);let n=1;while(names.includes('Frame '+n))n++;const group={id:crypto.randomUUID(),name:'Frame '+n,kind:'group',visible:true,locked:false,opacity:1,blend:'source-over',passThrough:true,collapsed:false,x:0,y:0,parentId:take?take.parentId||null:active?.parentId||null,canvas:surface(1,1),maskDefault:0,maskOffsetX:box.x,maskOffsetY:box.y};if(box.w>=1&&box.h>=1){const mask=surface(box.w,box.h),ctx=mask.getContext('2d');if(ellipse){const cov=ellipseMask(rect,this.width,this.height),image=ctx.createImageData(cov.w,cov.h);for(let i=0;i<cov.alpha.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=cov.alpha[i];}ctx.putImageData(image,0,0);}else{ctx.fillStyle='#fff';ctx.fillRect(0,0,box.w,box.h);}group.mask=mask;}else group.mask=surface(1,1);const index=take?this.layers.indexOf(take)+1:active?this.layers.indexOf(active)+1:this.layers.length;this.layers.splice(index,0,group);if(take)take.parentId=group.id;this.activeId=group.id;this.selectedLayerIds=[group.id];this.changed();return group;}
  frameFromLayers(name){const selected=this.selectedRoots();if(!selected.length)throw Error('select a layer');const parentId=selected[0].parentId||null;if(selected.some(layer=>(layer.parentId||null)!==parentId))throw Error('Select layers from the same group to group them.');if(selected.some(layer=>this.isLocked(layer)))throw Error('Unlock the selected layers before grouping.');let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const root of selected)for(const id of this.descendants(root.id)){const layer=this.layers.find(item=>item.id===id);if(!layer?.canvas||layer.kind==='group'||layer.kind==='adjustment')continue;left=Math.min(left,layer.x||0);top=Math.min(top,layer.y||0);right=Math.max(right,(layer.x||0)+layer.canvas.width);bottom=Math.max(bottom,(layer.y||0)+layer.canvas.height);}if(!Number.isFinite(left)){left=0;top=0;right=this.width;bottom=this.height;}const box=frameMaskRect({x:Math.floor(left),y:Math.floor(top),w:Math.ceil(right-left),h:Math.ceil(bottom-top)},this.width,this.height);this.checkpoint('Frame from Layers');const group={id:crypto.randomUUID(),name:String(name||'').trim().slice(0,200)||'Frame',kind:'group',passThrough:true,parentId,collapsed:false,visible:true,locked:false,opacity:1,blend:'source-over',x:0,y:0,canvas:surface(1,1),maskDefault:0,maskOffsetX:box.x,maskOffsetY:box.y};const mask=surface(Math.max(1,box.w),Math.max(1,box.h));if(box.w>=1&&box.h>=1){const ctx=mask.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,box.w,box.h);}group.mask=mask;this.layers.splice(Math.max(...selected.map(layer=>this.layers.indexOf(layer)))+1,0,group);for(const layer of selected)layer.parentId=group.id;this.activeId=group.id;this.selectedLayerIds=[group.id];this.changed();return group;}
  rotateArbitrary(deg,background='#ffffff'){const width=this.width,height=this.height,next=rotatedSize(width,height,deg);if(next.width>32767||next.height>32767||next.width*next.height>64000000)throw Error('The rotated image exceeds the image size limit.');const rad=deg*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad),cx=width/2,cy=height/2,nx=next.width/2,ny=next.height/2,e=nx-(cs*cx-sn*cy),f=ny-(sn*cx+cs*cy),map=(x,y)=>({x:cs*x-sn*y+e,y:sn*x+cs*y+f});for(const layer of this.layers){const backgroundLayer=!layer.parentId&&!layer.kind&&!layer.clipping&&layer.lockAlpha&&layer.lockPosition&&layer.visible!==false;if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(next.width,next.height):null;if(mask){const ctx=mask.getContext('2d');ctx.setTransform(cs,sn,-sn,cs,e,f);ctx.drawImage(layer.mask,(layer.x||0)+(layer.maskOffsetX||0),(layer.y||0)+(layer.maskOffsetY||0));}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(next.width,next.height);layer.x=layer.y=0;continue;}const canvas=surface(next.width,next.height),ctx=canvas.getContext('2d');if(backgroundLayer){ctx.fillStyle=background;ctx.fillRect(0,0,next.width,next.height);}ctx.setTransform(cs,sn,-sn,cs,e,f);ctx.drawImage(layer.canvas,layer.x||0,layer.y||0);layer.canvas=canvas;layer.x=layer.y=0;layer.text=null;layer.shape=null;if(layer.kind==='smart'){layer.kind=null;layer.smartSource=null;layer.smartOperations=null;}}[...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const canvas=surface(next.width,next.height),ctx=canvas.getContext('2d');ctx.setTransform(cs,sn,-sn,cs,e,f);ctx.drawImage(channel.canvas,0,0);channel.canvas=canvas;});this.paths.forEach(path=>transformPath(path,(x,y)=>map(x,y)));this.layers.forEach(layer=>{if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>map(x,y));});this.guides=[];this.width=next.width;this.height=next.height;this.selection=null;}
  cropRotated(frame,angle,deletePixels=true,background='#ffffff',contentAware=false,target=null){const oldW=this.width,oldH=this.height,dest=rotatedCropRect(oldW,oldH,frame,angle);if(!dest)throw Error('The rotated frame is outside the coordinate range.');this.checkpoint('Crop');this.rotateArbitrary(-angle,background);this.crop(dest,deletePixels,false,{contentAware,coverage:contentAware?cropCoverage(oldW,oldH,angle,dest):null,background,targetWidth:target?.width,targetHeight:target?.height,resolution:target?.resolution});}
  fillCropGaps(cov){const layer=this.layers.find(item=>!item.parentId&&!item.kind&&!item.clipping&&item.lockAlpha&&item.lockPosition);if(!layer?.canvas)throw Error('Content-Aware crop fill needs a Background layer.');const w=layer.canvas.width,h=layer.canvas.height;if(w*h>400000000)throw Error('the crop is too large for Content-Aware fill');const hole=new Uint8Array(w*h);let uncovered=0,covered=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(cropCovered(cov,x,y))covered++;else{hole[y*w+x]=1;uncovered++;}}if(!uncovered)return;if(!covered)throw Error('Content-Aware fill needs some of the image inside the crop to sample from.');const ctx=layer.canvas.getContext('2d'),image=ctx.getImageData(0,0,w,h),pieces=cropPieces(hole,w,h);for(const piece of pieces.pieces){const one=new Uint8Array(w*h);for(let i=0;i<pieces.labels.length;i++)if(pieces.labels[i]===piece.id)one[i]=1;const covered=new Uint8Array(w*h);for(let i=0;i<hole.length;i++)if(!hole[i])covered[i]=1;contentAwareImage({width:w,height:h,data:image.data},{hole:one,source:covered,radius:3,seed:1});}ctx.putImageData(image,0,0);}
  resampleDocument(width,height){width=Math.round(width);height=Math.round(height);if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The crop exceeds the image size limit.');if(width===this.width&&height===this.height)return;const sx=width/this.width,sy=height/this.height;for(const layer of this.layers){layer.x=Math.round((layer.x||0)*sx);layer.y=Math.round((layer.y||0)*sy);if(!layer.canvas||layer.kind==='group'||layer.kind==='adjustment')continue;const image=layer.canvas.getContext('2d').getImageData(0,0,layer.canvas.width,layer.canvas.height),result=resamplePixels(image,0,0,sx,sy,'bicubic',layer.canvas.width,layer.canvas.height),output=surface(result.width,result.height);output.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);layer.canvas=output;}this.width=width;this.height=height;}
  crop(rect = this.selection,deletePixels=true,record=true,options={}) {
    if (!rect) return;
    const extend=Boolean(options.extend),oldW=this.width,oldH=this.height;
    const x = extend?Math.floor(rect.x):Math.max(0, Math.floor(rect.x)), y = extend?Math.floor(rect.y):Math.max(0, Math.floor(rect.y));
    const width = extend?Math.round(rect.w):Math.min(this.width - x, Math.round(rect.w)), height = extend?Math.round(rect.h):Math.min(this.height - y, Math.round(rect.h));
    if (extend&&(width<1||height<1||width>32767||height>32767||width*height>64000000))throw Error('The crop exceeds the image size limit.');
    if (width < 1 || height < 1) return;
    const spills=x<0||y<0||x+width>oldW||y+height>oldH;
    if(record)this.checkpoint('Crop');
    for (const layer of this.layers) {
      const backgroundLayer=!layer.parentId&&!layer.kind&&!layer.clipping&&layer.lockAlpha&&layer.lockPosition;
      if(backgroundLayer&&spills){const next=surface(width,height),ctx=next.getContext('2d');ctx.fillStyle=options.background||'#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(layer.canvas,(layer.x||0)-x,(layer.y||0)-y);layer.canvas=next;layer.x=layer.y=0;continue;}
      if(layer.text){layer.x-=x;layer.y-=y;continue;}
      if(layer.kind==='smart'){layer.x-=x;layer.y-=y;layer.smartOrigin.x-=x;layer.smartOrigin.y-=y;layer.smartOperations=translateSmartOperations(layer.smartOperations,-x,-y);translateSmartRecord(layer,-x,-y,true);continue;}
      if(!deletePixels&&!['adjustment','group'].includes(layer.kind)){layer.x-=x;layer.y-=y;continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(width,height):null;if(mask)mask.getContext('2d').drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)-x,layer.y+(layer.maskOffsetY||0)-y);layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(width,height);layer.x=layer.y=0;continue;}
      const next = surface(width, height); next.getContext('2d').drawImage(this.layerPixels(layer), layer.x - x, layer.y - y);
      layer.canvas = next; layer.x = layer.y = 0; layer.mask = null; layer.vectorMask=null; layer.text = null;layer.shape=null;
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(width,height);next.getContext('2d').drawImage(channel.canvas,-x,-y);channel.canvas=next;});this.guides=this.guides.map(guide=>({...guide,position:guide.position-(guide.axis==='vertical'?x:y)}));
    this.paths.forEach(path=>transformPath(path,(px,py)=>({x:px-x,y:py-y})));this.layers.forEach(layer=>{if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(px,py)=>({x:px-x,y:py-y}));});
    this.width = width; this.height = height; this.selection = null; if(options.contentAware)this.fillCropGaps(options.coverage||plainCropCoverage(oldW,oldH,x,y)); if(options.targetWidth&&options.targetHeight)this.resampleDocument(options.targetWidth,options.targetHeight); if(Number.isFinite(options.resolution)&&options.resolution>=1&&options.resolution<=10000)this.resolution=options.resolution; this.changed();
  }
  drawGenerated(image,label,newLayer=false,replace=false){
    const original=this.active,create=newLayer||!original||original.kind||original.text||original.shape;
    if(!create&&this.isLocked(original))throw Error('Unlock the target layer before rendering.');
    const parentId=original?.parentId||null;if(create&&parentId&&this.isLocked(this.layers.find(layer=>layer.id===parentId)))throw Error('Unlock the destination group before rendering.');
    const ox=Number(image.x)||0,oy=Number(image.y)||0,paint=surface(image.width,image.height);paint.getContext('2d').putImageData(image,0,0);
    let canvas,x=0,y=0;if(create)canvas=ox||oy?paint:surface(this.width,this.height);else{x=Math.floor(Math.min(0,original.x,ox));y=Math.floor(Math.min(0,original.y,oy));const width=Math.ceil(Math.max(this.width,original.x+original.canvas.width,ox+image.width))-x,height=Math.ceil(Math.max(this.height,original.y+original.canvas.height,oy+image.height))-y;if(width>32767||height>32767||width*height>64000000)throw Error('Rendering exceeds the layer size limit.');canvas=surface(width,height);canvas.getContext('2d').drawImage(original.canvas,original.x-x,original.y-y);}
    const priorRedo=this.redoStack,wasDirty=this.dirty;this.checkpoint(label);const checkpoint=this.undoStack.at(-1);
    try{let layer;if(create){layer=this.addLayer(label,canvas,false);layer.parentId=parentId;if(ox||oy){layer.x=ox;layer.y=oy;}}else{layer=original;if(layer.mask){layer.maskOffsetX=(layer.maskOffsetX||0)+layer.x-x;layer.maskOffsetY=(layer.maskOffsetY||0)+layer.y-y;}layer.canvas=canvas;layer.x=x;layer.y=y;}
      this.editPixels(layer.canvas,ctx=>{if(replace)ctx.clearRect(-x,-y,this.width,this.height);ctx.drawImage(paint,create&&(ox||oy)?0:ox-x,create&&(ox||oy)?0:oy-y);},layer);this.changed();return layer;
    }catch(error){if(this.undoStack.at(-1)===checkpoint){this.undoStack.pop();this.historyBytes-=checkpoint.bytes;}this.redoStack=priorRedo;this.restore(checkpoint.state);this.dirty=wasDirty;this.dispatchEvent(new Event('change'));throw error;}
  }
  resize(width, height, scalePixels = true, settings = {}) {
    if(!scalePixels&&settings.relative){width+=this.width;height+=this.height;}
    const extension=settings.extensionColor??'#ffffff';
    if(!scalePixels&&extension!=='transparent'&&!/^#[0-9a-f]{6}$/i.test(extension))throw Error('Choose an extension color.');
    if(scalePixels&&settings.resample==='none'){const resolution=Number(settings.resolution??this.resolution);if(!Number.isFinite(resolution)||resolution<1||resolution>10000)throw Error('Choose a resolution between 1 and 10000 PPI.');if(resolution!==this.resolution){this.checkpoint('Image Size');this.resolution=resolution;this.changed();}return;}
    if(scalePixels&&settings.resolution!==undefined&&(!Number.isFinite(settings.resolution)||settings.resolution<1||settings.resolution>10000))throw Error('Choose a resolution between 1 and 10000 PPI.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32767 || height > 32767 || width * height > 64000000) throw Error('Choose dimensions up to 32,767 pixels per side and 64 million pixels.');
    if(!scalePixels){
      const anchors={topLeft:[0,0],top:[.5,0],topRight:[1,0],left:[0,.5],center:[.5,.5],right:[1,.5],bottomLeft:[0,1],bottom:[.5,1],bottomRight:[1,1]},anchor=anchors[settings.anchor||'center'];if(!anchor)throw Error('Choose a supported canvas anchor.');
      if(width===this.width&&height===this.height)return;
      const round=value=>value<0?-Math.round(-value):Math.round(value),dx=round((width-this.width)*anchor[0]),dy=round((height-this.height)*anchor[1]);
      const oldWidth=this.width,oldHeight=this.height,background=this.layers.find(layer=>!layer.parentId),isBackground=background&&!background.kind&&!background.text&&!background.shape&&background.lockAlpha&&background.lockPosition&&!background.clipping;
      const priorRedo=this.redoStack,wasDirty=this.dirty;this.checkpoint('Canvas Size');const checkpoint=this.undoStack.at(-1);
      try{
      for(const layer of this.layers){
        if(layer.kind==='group'){if(layer.mask){layer.maskOffsetX=(layer.maskOffsetX||0)+dx;layer.maskOffsetY=(layer.maskOffsetY||0)+dy;}continue;}
        layer.x+=dx;layer.y+=dy;
        if(layer.kind==='smart'){layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);translateSmartRecord(layer,dx,dy,true);}
      }
      for(const layer of this.layers)if(this.canRefreshFill(layer))this.refreshFill(layer,width,height);
      if(isBackground){
        if(extension==='transparent'&&(width>oldWidth||height>oldHeight)){background.lockAlpha=false;background.lockPosition=false;background.locked=false;background.name='Layer 0';}
        else if(extension!=='transparent'){
          const x=Math.min(0,background.x),y=Math.min(0,background.y),right=Math.max(width,background.x+background.canvas.width),bottom=Math.max(height,background.y+background.canvas.height);
          if(right-x>32767||bottom-y>32767||(right-x)*(bottom-y)>64000000)throw Error('The extended Background exceeds the image size limit.');
          const output=surface(right-x,bottom-y),ctx=output.getContext('2d');ctx.drawImage(background.canvas,background.x-x,background.y-y);ctx.fillStyle=extension;ctx.fillRect(-x,-y,width,height);ctx.save();ctx.beginPath();ctx.rect(dx-x,dy-y,oldWidth,oldHeight);ctx.clip();ctx.clearRect(dx-x,dy-y,oldWidth,oldHeight);ctx.drawImage(background.canvas,background.x-x,background.y-y);ctx.restore();
          if(background.mask){background.maskOffsetX=(background.maskOffsetX||0)+background.x-x;background.maskOffsetY=(background.maskOffsetY||0)+background.y-y;}background.canvas=output;background.x=x;background.y=y;
        }
      }
      for(const channel of [...this.channels,...(this.quickMask?[this.quickMask]:[])]){const next=surface(width,height);next.getContext('2d').drawImage(channel.canvas,dx,dy);channel.canvas=next;}
      this.guides=this.guides.map(guide=>({...guide,position:guide.position+(guide.axis==='vertical'?dx:dy)}));this.paths.forEach(path=>transformPath(path,(x,y)=>({x:x+dx,y:y+dy})));this.layers.forEach(layer=>{if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>({x:x+dx,y:y+dy}));});
      this.selection=offsetSelection(this.selection,dx,dy);this.previousSelection=offsetSelection(this.previousSelection,dx,dy);this.width=width;this.height=height;this.changed();return;
      }catch(error){if(this.undoStack.at(-1)===checkpoint){this.undoStack.pop();this.historyBytes-=checkpoint.bytes;}this.redoStack=priorRedo;this.restore(checkpoint.state);this.dirty=wasDirty;this.dispatchEvent(new Event('change'));throw error;}
    }
    const oldWidth=this.width,oldHeight=this.height,sx=width/oldWidth,sy=height/oldHeight;
    const boundsOf=(canvas,x,y)=>({x:Math.floor(x*sx),y:Math.floor(y*sy),width:Math.max(1,Math.ceil((x+canvas.width)*sx)-Math.floor(x*sx)),height:Math.max(1,Math.ceil((y+canvas.height)*sy)-Math.floor(y*sy))});
    const validate=bounds=>{if(bounds.width>32767||bounds.height>32767||bounds.width*bounds.height>64000000)throw Error('A resized layer or mask exceeds the image size limit.');};
    for(const layer of this.layers){if(!['group','adjustment'].includes(layer.kind))validate(boundsOf(layer.canvas,layer.x,layer.y));if(layer.mask){const origin=this.maskOrigin(layer);validate(boundsOf(layer.mask,origin.x,origin.y));}}
    const resample=(canvas,x,y,method=settings.resample||'bicubic')=>{
      if(!Number.isInteger(x)||!Number.isInteger(y)){const ix=Math.floor(x),iy=Math.floor(y),aligned=surface(Math.ceil(x+canvas.width)-ix,Math.ceil(y+canvas.height)-iy);aligned.getContext('2d').drawImage(canvas,x-ix,y-iy);canvas=aligned;x=ix;y=iy;}
      const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),result=resamplePixels(image,x,y,sx,sy,method,oldWidth,oldHeight),output=surface(result.width,result.height);output.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);return{...result,canvas:output};
    };
    const priorRedo=this.redoStack,wasDirty=this.dirty;this.checkpoint('Image Size');const checkpoint=this.undoStack.at(-1);
    try{
    for(const layer of this.layers){
      const oldX=layer.x,oldY=layer.y,mask=layer.mask,maskOrigin=mask?this.maskOrigin(layer):null;
      if(layer.text){const next=resample(layer.canvas,oldX,oldY),matrix=[sx,0,0,sy,oldX*sx-next.x,oldY*sy-next.y];layer.text={...layer.text,matrix:multiplyAffine(matrix,layer.text.matrix||[1,0,0,1,0,0])};layer.canvas=next.canvas;layer.x=next.x;layer.y=next.y;}
      else if(this.canRefreshFill(layer))this.refreshFill(layer,width,height);
      else if(layer.kind==='smart'){const settingsForResize={scaleX:sx,scaleY:sy,method:settings.resample||'bicubic',canvasWidth:oldWidth,canvasHeight:oldHeight};this.resizeSmartPixels(layer,settingsForResize);layer.smartOperations=[...(layer.smartOperations||[]),{type:'resizePixels',settings:settingsForResize}];}
      else if(['group','adjustment'].includes(layer.kind)){layer.x=oldX*sx;layer.y=oldY*sy;layer.canvas=surface(width,height);}
      else{const next=resample(layer.canvas,oldX,oldY);layer.shape=transformedShape(layer.shape,[sx,0,0,sy,oldX*sx,oldY*sy],next);layer.canvas=next.canvas;layer.x=next.x;layer.y=next.y;}
      if(mask){const next=resample(mask,maskOrigin.x,maskOrigin.y,'bilinear');layer.mask=next.canvas;layer.maskOffsetX=next.x-layer.x;layer.maskOffsetY=next.y-layer.y;}
      if(layer.effects&&settings.scaleStyles!==false){const factor=(sx+sy)/2,keys={shadow:['distance','blur'],innerShadow:['distance','blur'],outerGlow:['blur'],innerGlow:['blur'],stroke:['size'],satin:['distance','size'],bevel:['size','soften'],patternOverlay:['scale']};for(const [effect,fields]of Object.entries(keys))for(const key of fields)if(Number.isFinite(layer.effects[effect]?.[key]))layer.effects[effect][key]*=factor;}
    }
    for(const channel of [...this.channels,...(this.quickMask?[this.quickMask]:[])])channel.canvas=resample(channel.canvas,0,0,'bilinear').canvas;
    this.guides=this.guides.map(guide=>({...guide,position:guide.position*(guide.axis==='vertical'?sx:sy)}));this.paths.forEach(path=>transformPath(path,(x,y)=>({x:x*sx,y:y*sy})));this.layers.forEach(layer=>{if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>({x:x*sx,y:y*sy}));});
    let resizedSelection=null;
    if(this.selection){const coverage=this.selectionCoverage(),pixels=new Uint8ClampedArray(oldWidth*oldHeight*4);for(let i=0;i<coverage.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=coverage[i];pixels[i*4+3]=255;}const result=resamplePixels({data:pixels,width:oldWidth,height:oldHeight},0,0,sx,sy,'bilinear',oldWidth,oldHeight),alpha=new Uint8ClampedArray(width*height);for(let i=0;i<alpha.length;i++)alpha[i]=result.data[i*4];resizedSelection=alphaSelection(alpha,width,height);}
    if(settings.resolution!==undefined)this.resolution=settings.resolution;
    this.width=width;this.height=height;this.selection=resizedSelection;this.previousSelection=null;this.changed();
    }catch(error){if(this.undoStack.at(-1)===checkpoint){this.undoStack.pop();this.historyBytes-=checkpoint.bytes;}this.redoStack=priorRedo;this.restore(checkpoint.state);this.dirty=wasDirty;this.dispatchEvent(new Event('change'));throw error;}
  }

  rotate(turns = 1) {
    this.checkpoint('Image Rotation'); const width = this.width, height = this.height;
    for (const layer of this.layers) {
      if(layer.text){const w=layer.canvas.width,h=layer.canvas.height,cx=layer.x+w/2,cy=layer.y+h/2;this.transformTypeLayer(layer,{angle:turns*90,x:(turns>0?height-cy:cy)-w/2,y:(turns>0?cx:width-cx)-h/2});continue;}
      if(layer.kind==='smart'){const w=layer.canvas.width,h=layer.canvas.height,cx=layer.x+w/2,cy=layer.y+h/2;this.transformSmartLayer(layer,{angle:turns*90,x:(turns>0?height-cy:cy)-w/2,y:(turns>0?cx:width-cx)-h/2});continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(height,width):null;if(mask){const ctx=mask.getContext('2d');ctx.translate(height/2,width/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)-width/2,layer.y+(layer.maskOffsetY||0)-height/2);}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>turns>0?{x:height-y,y:x}:{x:y,y:width-x});layer.canvas=surface(height,width);layer.x=layer.y=0;continue;}
      const w=layer.canvas.width,h=layer.canvas.height,cx=layer.x+w/2,cy=layer.y+h/2;this.transformTypeLayer(layer,{angle:turns*90,x:(turns>0?height-cy:cy)-w/2,y:(turns>0?cx:width-cx)-h/2});
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(height,width),ctx=next.getContext('2d');ctx.translate(height/2,width/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(channel.canvas,-width/2,-height/2);channel.canvas=next;});this.guides=this.guides.map(guide=>({axis:guide.axis==='vertical'?'horizontal':'vertical',position:turns>0?(guide.axis==='vertical'?guide.position:height-guide.position):(guide.axis==='vertical'?width-guide.position:guide.position)}));
    this.paths.forEach(path=>transformPath(path,(x,y)=>turns>0?{x:height-y,y:x}:{x:y,y:width-x}));
    this.width = height; this.height = width; this.selection = null; this.changed();
  }
  rotate180(){
    this.checkpoint('Image Rotation');const width=this.width,height=this.height;
    for(const layer of this.layers){
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(width,height):null;if(mask){const ctx=mask.getContext('2d');ctx.translate(width,height);ctx.rotate(Math.PI);ctx.drawImage(layer.mask,(layer.x||0)+(layer.maskOffsetX||0),(layer.y||0)+(layer.maskOffsetY||0));}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>({x:width-x,y:height-y}));continue;}
      const w=layer.canvas.width,h=layer.canvas.height,settings={angle:180,x:width-(layer.x||0)-w,y:height-(layer.y||0)-h};
      if(layer.kind==='smart')this.transformSmartLayer(layer,settings);else this.transformTypeLayer(layer,settings);
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(width,height),ctx=next.getContext('2d');ctx.translate(width,height);ctx.rotate(Math.PI);ctx.drawImage(channel.canvas,0,0);channel.canvas=next;});
    this.guides=this.guides.map(guide=>({...guide,position:(guide.axis==='vertical'?width:height)-guide.position}));
    this.paths.forEach(path=>transformPath(path,(x,y)=>({x:width-x,y:height-y})));
    this.selection=null;this.changed();
  }
  flip(horizontal) {
    this.checkpoint(horizontal ? 'Flip Horizontal' : 'Flip Vertical');
    for (const layer of this.layers) {
      if(layer.text){this.transformTypeLayer(layer,{scaleX:horizontal?-1:1,scaleY:horizontal?1:-1,x:horizontal?this.width-layer.x-layer.canvas.width:layer.x,y:horizontal?layer.y:this.height-layer.y-layer.canvas.height});continue;}
      if(layer.kind==='smart'){this.transformSmartLayer(layer,{scaleX:horizontal?-1:1,scaleY:horizontal?1:-1,x:horizontal?this.width-layer.x-layer.canvas.width:layer.x,y:horizontal?layer.y:this.height-layer.y-layer.canvas.height});continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(this.width,this.height):null;if(mask){const ctx=mask.getContext('2d');ctx.translate(horizontal?this.width:0,horizontal?0:this.height);ctx.scale(horizontal?-1:1,horizontal?1:-1);ctx.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0),layer.y+(layer.maskOffsetY||0));}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;if(layer.vectorMask?.path)transformPath(layer.vectorMask.path,(x,y)=>({x:horizontal?this.width-x:x,y:horizontal?y:this.height-y}));layer.canvas=surface(this.width,this.height);layer.x=layer.y=0;continue;}
      this.transformTypeLayer(layer,{scaleX:horizontal?-1:1,scaleY:horizontal?1:-1,x:horizontal?this.width-layer.x-layer.canvas.width:layer.x,y:horizontal?layer.y:this.height-layer.y-layer.canvas.height});
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(this.width,this.height),ctx=next.getContext('2d');ctx.translate(horizontal?this.width:0,horizontal?0:this.height);ctx.scale(horizontal?-1:1,horizontal?1:-1);ctx.drawImage(channel.canvas,0,0);channel.canvas=next;});this.guides=this.guides.map(guide=>({...guide,position:guide.axis===(horizontal?'vertical':'horizontal')?(horizontal?this.width:this.height)-guide.position:guide.position}));
    this.paths.forEach(path=>transformPath(path,(x,y)=>({x:horizontal?this.width-x:x,y:horizontal?y:this.height-y})));
    this.selection = null; this.changed();
  }
  filter(name, amount = 1, record = true) {
    const layer=this.paintLayer;if(!layer||this.isLocked(layer))return;const maskTarget=Boolean(layer.editMask&&layer.mask);
    if(['adjustment','group'].includes(layer.kind)&&!maskTarget)throw Error('Select a raster layer or layer mask.');
    if(record&&layer.kind==='smart'&&!maskTarget){this.checkpoint(name);layer.smartOperations=[...(layer.smartOperations||[]),{type:'filter',name,amount:structuredClone(amount),selection:this.selection?structuredClone(this.selection):null,selectionOrigin:{x:layer.x,y:layer.y},enabled:true}];this.rebuildSmart(layer);return;}
    if(record)this.checkpoint(name);const source=copyCanvas(maskTarget?layer.mask:layer.canvas),ctx=source.getContext('2d');let image=ctx.getImageData(0,0,source.width,source.height);
    if(maskTarget){for(let i=0;i<image.data.length;i+=4){image.data[i]=image.data[i+1]=image.data[i+2]=image.data[i+3];image.data[i+3]=255;}ctx.putImageData(image,0,0);}
    image=adjustPixels(image,name,amount)||image;
    this.applyFilterPixels(image,name,amount,false);
  }
  applyFilterPixels(image,name,amount,record=true){
    if(name==='Color to Alpha'&&this.isAlphaLocked(this.paintLayer))throw Error('Unlock transparent pixels before applying Color to Alpha.');
    const layer=this.paintLayer;if(!layer||this.isLocked(layer))return;const maskTarget=layer.editMask&&layer.mask;let target=maskTarget?layer.mask:layer.canvas;const ox=Number(image.x)||0,oy=Number(image.y)||0;
    if(record&&layer.kind==='smart'&&!maskTarget&&layer.smartFilterMask?.canvas){this.filter(name,amount,true);return;}
    if(record){this.checkpoint(name);if(layer.kind==='smart'&&!maskTarget)layer.smartOperations=[...(layer.smartOperations||[]),{type:'filter',name,amount:structuredClone(amount),selection:this.selection?structuredClone(this.selection):null,selectionOrigin:{x:layer.x,y:layer.y},enabled:true}];}
    if(ox||oy||image.width!==target.width||image.height!==target.height){if(image.width>32767||image.height>32767||image.width*image.height>64000000)throw Error('Rendering exceeds the layer size limit.');if(maskTarget){layer.mask=surface(image.width,image.height);layer.maskOffsetX=(layer.maskOffsetX||0)+ox;layer.maskOffsetY=(layer.maskOffsetY||0)+oy;target=layer.mask;}else{layer.canvas=surface(image.width,image.height);layer.x+=ox;layer.y+=oy;if(layer.mask){layer.maskOffsetX=(layer.maskOffsetX||0)-ox;layer.maskOffsetY=(layer.maskOffsetY||0)-oy;}target=layer.canvas;}}
    if(maskTarget){image=new ImageData(new Uint8ClampedArray(image.data),image.width,image.height);for(let i=0;i<image.data.length;i+=4){image.data[i+3]=(image.data[i]*.2126+image.data[i+1]*.7152+image.data[i+2]*.0722)*image.data[i+3]/255;image.data[i]=image.data[i+1]=image.data[i+2]=255;}}
    const output=surface(image.width,image.height);output.getContext('2d').putImageData(image,0,0);this.editPixels(target,ctx=>{ctx.clearRect(0,0,image.width,image.height);ctx.drawImage(output,0,0);},layer);if(!maskTarget){layer.text=null;layer.shape=null;}this.changed();
  }
  async project() {
    return JSON.stringify({historyLog:historyLogRecord(this.historyLog),format: 'chameleon-photo-editor', version: 1,countGroups:this.countGroups,activeCountGroup:this.activeCountGroup,ruler:this.ruler,notes:this.notes,slices:this.slices,layerComps:this.layerComps,appliedComp:this.appliedComp,lastCompState:this.lastCompState,psdMode:this.psdMode||null,iccProfile:this.iccProfile?Array.from(this.iccProfile):null,duotoneRaw:this.duotoneRaw?Array.from(this.duotoneRaw):null,colorTable:this.colorTable?Array.from(this.colorTable):null,capture:this.capture||null, width: this.width, height: this.height,resolution:this.resolution, name: this.name,activeId:this.activeId,selectedLayerIds:this.selectedLayerIds,selection:packSelection(this.selection),previousSelection:packSelection(this.previousSelection),activeChannelId:this.activeChannelId,quickMask:this.quickMask?{id:this.quickMask.id,name:this.quickMask.name,displayInfo:this.quickMask.displayInfo,pixels:this.quickMask.canvas.toDataURL('image/png')}:null,channels:this.channels.map(({canvas,...channel})=>({...channel,pixels:canvas.toDataURL('image/png')})),guides:this.guides,paths:this.paths,activePathId:this.activePathId,
      layers: this.layers.map(({canvas, mask,smartSource,smartFile,smartFilterMask, ...layer}) => ({...layer,smartSource:smartSource?smartSource.toDataURL('image/png'):null,smartFile:smartFile?bytesToBase64(smartFile):null,smartFilterMask:smartFilterMask?{x:smartFilterMask.x,y:smartFilterMask.y,enabled:smartFilterMask.enabled!==false,linked:Boolean(smartFilterMask.linked),extendWhite:smartFilterMask.extendWhite!==false,pixels:smartFilterMask.canvas.toDataURL('image/png')}:null, mask:mask?mask.toDataURL('image/png'):null, pixels: canvas.toDataURL('image/png')}))},(key,value)=>ArrayBuffer.isView(value)?Array.from(value):value);
  }
  static async fromProject(text) {
    const data = JSON.parse(text);
    if (data.format !== 'chameleon-photo-editor' || data.version !== 1 || !Array.isArray(data.layers) || data.layers.length > 200 ||
      !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || data.width > 32767 || data.height > 32767 || data.width * data.height > 64000000) throw Error('Invalid Photo Editor project.');
    const restoredCounts=countRecord(data.countGroups),restoredRuler=rulerRecord(data.ruler),restoredComps=validateLayerComps(data.layerComps),restoredLast=data.lastCompState?validateLayerComps([data.lastCompState])[0]:null;
    const doc = new EditorDocument(data.width, data.height, data.name);doc.historyLog=historyLogRecord(data.historyLog);const restoredNotes=noteRecord(data.notes);if(!restoredNotes)throw Error('Invalid notes.');doc.notes=restoredNotes;const restoredSlices=sliceRecord(data.slices);if(!restoredSlices)throw Error('Invalid slices.');doc.slices=restoredSlices;if(data.iccProfile){if(!Array.isArray(data.iccProfile)||data.iccProfile.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid project ICC profile.');doc.iccProfile=validateProfile(data.iccProfile);}if(data.duotoneRaw!=null){if(!Array.isArray(data.duotoneRaw)||data.duotoneRaw.length>16777216||data.duotoneRaw.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid duotone data.');doc.duotoneRaw=Uint8Array.from(data.duotoneRaw);}if(data.colorTable!=null){if(!Array.isArray(data.colorTable)||data.colorTable.length!==768||data.colorTable.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid color table.');doc.colorTable=Uint8Array.from(data.colorTable);}if(data.psdMode!=null){if(!['multichannel','duotone','indexed'].includes(data.psdMode))throw Error('Invalid document mode.');doc.psdMode=data.psdMode;}if(data.capture!=null){const capture=captureRecord(data.capture);if(!capture)throw Error('Invalid capture record.');doc.capture=capture;}doc.resolution=Math.max(1,Math.min(10000,Number(data.resolution)||72));
    const layerIds=new Set(data.layers.map(entry=>entry.id));if(layerIds.size!==data.layers.length||data.layers.some(entry=>typeof entry.id!=='string'))throw Error('Invalid layer identifiers.');
    doc.guides=Array.isArray(data.guides)?data.guides.filter(guide=>['horizontal','vertical'].includes(guide.axis)&&Number.isFinite(guide.position)):[];
    doc.paths=Array.isArray(data.paths)?data.paths.filter(path=>{
      if(!path||!Array.isArray(path.nodes)||path.subpaths!=null&&(!Array.isArray(path.subpaths)||path.subpaths.length>10000))return false;
      let count=0;return pathContours(path).every(contour=>contour&&Array.isArray(contour.nodes)&&(count+=contour.nodes.length)<=10000&&contour.nodes.every(node=>node&&Number.isFinite(node.x)&&Number.isFinite(node.y)&&['inX','inY','outX','outY'].every(key=>node[key]==null||Number.isFinite(node[key]))));
    }).map(path=>structuredClone(path)):[];
    doc.activePathId=doc.paths.some(path=>path.id===data.activePathId)?data.activePathId:null;
    for (const entry of data.layers) {
      if (!/^data:image\/png;base64,/.test(entry.pixels)) throw Error('Invalid layer image.');
      const image = await loadImage(entry.pixels);
      const layer = doc.addLayer(String(entry.name || 'Layer'), image, false);
      layer.id=entry.id;layer.parentId=layerIds.has(entry.parentId)?entry.parentId:null;layer.clipping=Boolean(entry.clipping);if(entry.kind==='group'){layer.kind='group';layer.collapsed=Boolean(entry.collapsed);layer.passThrough=Boolean(entry.passThrough);if(entry.artboard!=null){const board=artboardRecord(entry.artboard);if(!board)throw Error('Invalid artboard.');layer.artboard=board;layer.passThrough=false;layer.parentId=null;}}doc.activeId=layer.id;
      layer.linkGroup=typeof entry.linkGroup==='string'&&entry.linkGroup.length<=128?entry.linkGroup:null;
      layer.x = Number(entry.x) || 0; layer.y = Number(entry.y) || 0;layer.maskOffsetX=Number(entry.maskOffsetX)||0;layer.maskOffsetY=Number(entry.maskOffsetY)||0;layer.maskLinked=entry.maskLinked!==false;layer.maskDisabled=Boolean(entry.maskDisabled);layer.maskDensity=entry.maskDensity==null?1:Math.max(0,Math.min(1,Number(entry.maskDensity)||0));layer.maskDefault=entry.maskDefault===255?255:0;layer.maskFeather=Math.max(0,Math.min(1000,Number(entry.maskFeather)||0));
      layer.visible = entry.visible !== false; layer.locked = Boolean(entry.locked);layer.lockAlpha=Boolean(entry.lockAlpha);layer.lockPosition=Boolean(entry.lockPosition);layer.fillOpacity=entry.fillOpacity==null?1:Math.max(0,Math.min(1,Number(entry.fillOpacity)||0));
      layer.opacity = Math.max(0, Math.min(1, Number(entry.opacity) || 0));
      layer.blend = String(entry.blend || 'source-over');
      if(entry.mask){if(!/^data:image\/png;base64,/.test(entry.mask))throw Error('Invalid layer mask.');layer.mask=copyCanvas(await loadImage(entry.mask));}
      if(entry.text&&typeof entry.text.value==='string')layer.text={...entry.text};
      if(entry.fill&&typeof entry.fill==='object')layer.fill=structuredClone(entry.fill);
      if(entry.shape&&typeof entry.shape==='object')layer.shape=structuredClone(entry.shape);
      if(entry.vectorMask!=null){const record=vectorMaskRecord(entry.vectorMask);if(!record)throw Error('Invalid vector mask.');layer.vectorMask=record;}
      if(entry.kind==='smart'&&entry.smartSource){layer.smartLink=smartLinkRecord(entry.smartLink);if(!/^data:image\/png;base64,/.test(entry.smartSource))throw Error('Invalid smart object source.');layer.kind='smart';layer.smartContentsId=typeof entry.smartContentsId==='string'&&entry.smartContentsId.length>0&&entry.smartContentsId.length<=128?entry.smartContentsId:entry.smartPsd?.id||crypto.randomUUID();layer.smartSource=copyCanvas(await loadImage(entry.smartSource));layer.smartOrigin={x:Number(entry.smartOrigin?.x)||0,y:Number(entry.smartOrigin?.y)||0};layer.smartOperations=Array.isArray(entry.smartOperations)?structuredClone(entry.smartOperations):[];layer.smartFiltersEnabled=entry.smartFiltersEnabled!==false;if(Array.isArray(entry.smartImportQuad)&&entry.smartImportQuad.length===8&&entry.smartImportQuad.every(Number.isFinite))layer.smartImportQuad=entry.smartImportQuad.slice();if(entry.smartDocument!==undefined&&entry.smartDocument!==null){if(typeof entry.smartDocument!=='string'||entry.smartDocument.length>100000000)throw Error('Invalid embedded document.');layer.smartDocument=entry.smartDocument;}if(entry.smartFile!=null){if(typeof entry.smartFile!=='string'||entry.smartFile.length>140000000)throw Error('Invalid smart object file.');layer.smartFile=base64ToBytes(entry.smartFile);}if(entry.smartPsd!=null){if(typeof entry.smartPsd!=='object'||Array.isArray(entry.smartPsd))throw Error('Invalid placed layer record.');layer.smartPsd=structuredClone(entry.smartPsd);}if(entry.smartFeid!=null){if(typeof entry.smartFeid!=='object'||Array.isArray(entry.smartFeid))throw Error('Invalid smart filter mask record.');layer.smartFeid=structuredClone(entry.smartFeid);}if(entry.smartFilterMask){if(!/^data:image\/png;base64,/.test(entry.smartFilterMask.pixels||''))throw Error('Invalid smart filter mask.');const maskImage=await loadImage(entry.smartFilterMask.pixels);layer.smartFilterMask={canvas:copyCanvas(maskImage),x:Number(entry.smartFilterMask.x)||0,y:Number(entry.smartFilterMask.y)||0,enabled:entry.smartFilterMask.enabled!==false,linked:Boolean(entry.smartFilterMask.linked),extendWhite:entry.smartFilterMask.extendWhite!==false};}}
      if(entry.effects&&typeof entry.effects==='object')layer.effects=structuredClone(entry.effects);
      if(entry.kind==='adjustment'&&entry.adjustment){layer.kind='adjustment';layer.adjustment=structuredClone(entry.adjustment);}
    }
    if(Array.isArray(data.channels))for(const entry of data.channels.slice(0,100)){if(!/^data:image\/png;base64,/.test(entry.pixels))throw Error('Invalid alpha channel.');const canvas=copyCanvas(await loadImage(entry.pixels));if(canvas.width!==doc.width||canvas.height!==doc.height)throw Error('Invalid alpha channel dimensions.');doc.channels.push({id:String(entry.id),name:String(entry.name||'Alpha Channel'),canvas,displayInfo:entry.displayInfo?.length===13&&Array.from(entry.displayInfo).every(v=>Number.isInteger(v)&&v>=0&&v<=255)?new Uint8Array(entry.displayInfo):null});}
    doc.selection=await unpackSelection(data.selection,loadImage);doc.previousSelection=await unpackSelection(data.previousSelection,loadImage);
    if(data.quickMask){if(!/^data:image\/png;base64,/.test(data.quickMask.pixels||''))throw Error('Invalid Quick Mask.');const image=await loadImage(data.quickMask.pixels);if(image.width!==doc.width||image.height!==doc.height)throw Error('Invalid Quick Mask dimensions.');doc.quickMask={id:'quick-mask',name:'Quick Mask',canvas:copyCanvas(image),displayInfo:data.quickMask.displayInfo?.length===13&&Array.from(data.quickMask.displayInfo).every(v=>Number.isInteger(v)&&v>=0&&v<=255)?new Uint8Array(data.quickMask.displayInfo):null};}
    doc.activeChannelId=['RGB','Red','Green','Blue','Alpha',...doc.channels.map(channel=>channel.id)].includes(data.activeChannelId)?data.activeChannelId:'RGB';
    for(const layer of doc.layers){const visited=new Set([layer.id]);let parentId=layer.parentId;while(parentId){if(visited.has(parentId)||visited.size>30)throw Error('Invalid layer group hierarchy.');visited.add(parentId);const parent=doc.layers.find(item=>item.id===parentId);if(parent?.kind!=='group')throw Error('Invalid layer group parent.');parentId=parent.parentId;}}
    if(doc.layers.some(layer=>layer.id===data.activeId))doc.activeId=data.activeId;doc.selectedLayerIds=Array.isArray(data.selectedLayerIds)?data.selectedLayerIds.filter(id=>doc.layers.some(layer=>layer.id===id)):doc.activeId?[doc.activeId]:[];
    doc.countGroups=restoredCounts;doc.activeCountGroup=restoredCounts.some(g=>g.id===data.activeCountGroup)?data.activeCountGroup:restoredCounts[0]?.id||null;doc.ruler=restoredRuler;doc.layerComps=restoredComps;doc.lastCompState=restoredLast;doc.appliedComp=doc.layerComps.some(c=>c.id===data.appliedComp)?data.appliedComp:null;
    doc.dirty = false; return doc;
  }
}
export function loadImage(url) {
  return new Promise((resolve, reject) => {const image = new Image(); image.onload = () => {if(!image.width||!image.height||image.width>32767||image.height>32767||image.width*image.height>64000000){reject(Error('Image exceeds the current canvas limits: 64 million pixels and 32,767 pixels per side.'));return;}resolve(image);}; image.onerror = () => reject(Error('Unable to decode image.')); image.src = url;});
}
