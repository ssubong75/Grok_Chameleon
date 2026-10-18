// Photo Editor document engine. Browser Canvas only; no Rust, WASM or build step.
import {adjustPixels} from './filters.js';
import {tracePath,transformPath,pathBounds,selectionPaths} from './paths.js';
import {layerMatrix,transformedBounds,translateSmartOperations,multiplyAffine} from './transforms.js';
import {colorSelection,modifySelection,selectionFromPixels,traceSelectionRuns,combineSelections,offsetSelection,alphaSelection,selectionWeight,featherPixels,extremePixels} from './selections.js';
import {renderEffects} from './layer-effects.js';
import {colorLuminance} from './brush-engine.js';
import {perspectivePixels} from './perspective.js';
import {customBlends,compositeCustom} from './blend-modes.js';
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
export class EditorDocument extends EventTarget {
  constructor(width, height, name = 'Untitled') {
    super(); this.width = width; this.height = height; this.name = name;this.resolution=72;
    this.layers = []; this.activeId = null;this.selectedLayerIds=[];this.selection = null;
    this.paths=[];this.activePathId=null;this.guides=[];this.channels=[];this.quickMask=null;this.activeChannelId='RGB';
    this.undoStack = []; this.redoStack = []; this.historyBytes = 0;
    this.dirty = false; this.revision = 0;
  }
  get active() { return this.layers.find(layer => layer.id === this.activeId); }
  get selectedLayers(){const selected=this.layers.filter(layer=>this.selectedLayerIds.includes(layer.id));return selected.length?selected:this.active?[this.active]:[];}
  get channelTarget(){return this.quickMask||this.channels.find(channel=>channel.id===this.activeChannelId);}
  get paintLayer(){const channel=this.channelTarget;if(!channel)return this.active;return{id:channel.id,name:channel.name,x:0,y:0,kind:'channel',editMask:true,locked:false,get canvas(){return channel.canvas;},set canvas(value){channel.canvas=value;},get mask(){return channel.canvas;},set mask(value){channel.canvas=value;}};}
  maskOrigin(layer=this.active){return{x:(layer?.x||0)+(layer?.maskOffsetX||0),y:(layer?.y||0)+(layer?.maskOffsetY||0)};}
  alignedMask(layer=this.active){if(!layer?.mask)return null;const output=surface(layer.canvas.width,layer.canvas.height);output.getContext('2d').drawImage(layer.mask,layer.maskOffsetX||0,layer.maskOffsetY||0);return output;}
  isLocked(layer=this.active){const visited=new Set();while(layer){if(layer.locked||visited.has(layer.id))return true;visited.add(layer.id);layer=this.layers.find(parent=>parent.id===layer.parentId);}return false;}
  hasLock(layer,key){const visited=new Set();while(layer&&!visited.has(layer.id)){if(layer[key])return true;visited.add(layer.id);layer=this.layers.find(parent=>parent.id===layer.parentId);}return false;}
  isAlphaLocked(layer=this.active){return this.hasLock(layer,'lockAlpha');}
  isPositionLocked(layer=this.active){return this.isLocked(layer)||this.hasLock(layer,'lockPosition');}
  changed() { this.dirty = true; this.revision++; this.dispatchEvent(new Event('change')); }
  snapshot(source=this) {
    return {width: source.width, height: source.height,resolution:source.resolution, activeId: source.activeId,selectedLayerIds:[...(source.selectedLayerIds||[])],
      paths:structuredClone(source.paths),activePathId:source.activePathId,guides:structuredClone(source.guides),activeChannelId:source.activeChannelId,quickMask:source.quickMask?{...source.quickMask,canvas:copyCanvas(source.quickMask.canvas)}:null,channels:source.channels.map(channel=>({...channel,canvas:copyCanvas(channel.canvas)})),
      selection: source.selection ? structuredClone(source.selection) : null,previousSelection:source.previousSelection?structuredClone(source.previousSelection):null,
      layers: source.layers.map(layer => ({...layer,fill:layer.fill?structuredClone(layer.fill):null,smartSource:layer.smartSource?copyCanvas(layer.smartSource):null,smartOperations:layer.smartOperations?structuredClone(layer.smartOperations):null,shape:layer.shape?structuredClone(layer.shape):null,effects:layer.effects?structuredClone(layer.effects):null,adjustment:layer.adjustment?structuredClone(layer.adjustment):null,text: layer.text ? {...layer.text} : null, mask: layer.mask ? copyCanvas(layer.mask) : null, canvas: copyCanvas(layer.canvas)}))};
  }
  restore(state) {
    this.width = state.width; this.height = state.height;this.resolution=state.resolution||72; this.activeId = state.activeId;this.selectedLayerIds=state.selectedLayerIds||[];
    this.selection = state.selection;this.previousSelection=state.previousSelection||null; this.layers = state.layers;
    this.paths=state.paths||[];this.activePathId=state.activePathId||null;this.guides=state.guides||[];this.channels=state.channels||[];this.quickMask=state.quickMask||null;this.activeChannelId=state.activeChannelId||'RGB';
    this.changed();
  }
  checkpoint(label) {
    const state = this.snapshot();
    const bytes = state.layers.reduce((n, layer) => n + (layer.canvas.width * layer.canvas.height+(layer.smartSource?layer.smartSource.width*layer.smartSource.height:0)+(layer.mask?layer.mask.width*layer.mask.height:0)) * 4, 0)+state.channels.reduce((n,channel)=>n+channel.canvas.width*channel.canvas.height*4,0)+(state.quickMask?state.quickMask.canvas.width*state.quickMask.canvas.height*4:0)+(state.selection?.pixels?.byteLength||0)+(state.previousSelection?.pixels?.byteLength||0);
    this.undoStack.push({label, state, bytes}); this.historyBytes += bytes; this.redoStack = [];
    while (this.undoStack.length > 1 && (this.undoStack.length > 30 || this.historyBytes > 192 * 1024 * 1024)) {
      this.historyBytes -= this.undoStack.shift().bytes;
    }
  }
  undo() {
    const previous = this.undoStack.pop(); if (!previous) return;
    this.historyBytes -= previous.bytes;
    this.redoStack.push({label: previous.label, state: this.snapshot(), bytes: previous.bytes});
    this.restore(previous.state);
  }
  redo() {
    const next = this.redoStack.pop(); if (!next) return;
    this.undoStack.push({label: next.label, state: this.snapshot(), bytes: next.bytes});
    this.historyBytes += next.bytes; this.restore(next.state);
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
  duplicate() {
    const originals=this.selectedRoots();if(!originals.length)return;this.checkpoint('Duplicate Layers');const created=[];
    const clone=(original,parentId=original.parentId)=>{const layer={...original,id:crypto.randomUUID(),parentId,name:original.name+' copy',canvas:copyCanvas(original.canvas),mask:original.mask?copyCanvas(original.mask):null,smartSource:original.smartSource?copyCanvas(original.smartSource):null,smartOperations:original.smartOperations?structuredClone(original.smartOperations):null,text:original.text?structuredClone(original.text):null,shape:original.shape?structuredClone(original.shape):null,effects:original.effects?structuredClone(original.effects):null};this.layers.splice(this.layers.indexOf(original)+1,0,layer);if(original.kind==='group')for(const child of this.layers.filter(item=>item.parentId===original.id))clone(child,layer.id);return layer;};
    for(const original of originals)created.push(clone(original));this.selectedLayerIds=created.map(layer=>layer.id);this.activeId=created.at(-1).id;this.changed();
  }
  createGroup(name='Group'){
    const selected=this.selectedRoots(),parentId=selected[0]?.parentId||null;if(selected.some(layer=>(layer.parentId||null)!==parentId))throw Error('Select layers from the same group to group them.');if(selected.some(layer=>this.isLocked(layer)))throw Error('Unlock the selected layers before grouping.');this.checkpoint('Group Layers');
    const group=this.addLayer(name,null,false);group.kind='group';group.parentId=parentId;group.collapsed=false;for(const layer of selected)layer.parentId=group.id;this.selectedLayerIds=[group.id];this.changed();return group;
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
    if(roots.some(layer=>this.isLocked(layer)))throw Error('Unlock selected layers before moving.');if(parentId&&roots.some(layer=>this.descendants(layer.id).has(parentId)))throw Error('A group cannot be moved into itself.');if(parentId&&this.isLocked(this.layers.find(layer=>layer.id===parentId)))throw Error('The destination group is locked.');this.checkpoint('Move Layers');const ids=new Set(roots.map(layer=>layer.id));this.layers=this.layers.filter(layer=>!ids.has(layer.id));for(const layer of roots)layer.parentId=parentId;const index=this.layers.indexOf(target);this.layers.splice(position==='below'?index:index+1,0,...roots);this.selectedLayerIds=roots.map(layer=>layer.id);this.activeId=roots.at(-1).id;this.changed();
  }
  translateLayers(dx,dy,record=true){
    if(this.selectedLayers.length===1&&this.active?.mask&&this.active.editMask&&this.active.maskLinked===false){if(this.isLocked(this.active))throw Error('Unlock this layer before moving its mask.');if(record)this.checkpoint('Move Layer Mask');this.active.maskOffsetX=(this.active.maskOffsetX||0)+dx;this.active.maskOffsetY=(this.active.maskOffsetY||0)+dy;this.changed();return;}
    const ids=new Set();for(const layer of this.selectedRoots())for(const id of this.descendants(layer.id))ids.add(id);const layers=this.layers.filter(layer=>ids.has(layer.id)&&layer.kind!=='group');if(this.layers.some(layer=>ids.has(layer.id)&&this.isPositionLocked(layer)))throw Error('Unlock selected layer positions before moving.');if(record)this.checkpoint('Move Layers');for(const layer of this.layers.filter(item=>ids.has(item.id)&&item.kind==='group'&&item.mask&&item.maskLinked!==false)){layer.maskOffsetX=(layer.maskOffsetX||0)+dx;layer.maskOffsetY=(layer.maskOffsetY||0)+dy;}for(const layer of layers)this.positionLayer(layer,layer.x+dx,layer.y+dy);this.changed();
  }
  positionLayer(layer,x,y){if(this.isPositionLocked(layer))throw Error('Unlock the layer position before moving.');const dx=x-layer.x,dy=y-layer.y;if(layer.mask&&layer.maskLinked===false){layer.maskOffsetX=(layer.maskOffsetX||0)-dx;layer.maskOffsetY=(layer.maskOffsetY||0)-dy;}layer.x=x;layer.y=y;if(layer.kind==='smart'&&layer.smartOrigin){layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);}}
  alignLayers(action){
    const layers=this.selectedLayers;if(!layers.length)return;if(layers.some(layer=>this.isPositionLocked(layer)||layer.kind==='group'))throw Error('Select image layers with unlocked positions to align.');
    const selection=this.selection&&!this.selection.inverse?this.selection:null,bounds=selection|| (layers.length===1?{x:0,y:0,w:this.width,h:this.height}:{x:Math.min(...layers.map(l=>l.x)),y:Math.min(...layers.map(l=>l.y)),w:0,h:0});
    if(!selection&&layers.length>1){bounds.w=Math.max(...layers.map(l=>l.x+l.canvas.width))-bounds.x;bounds.h=Math.max(...layers.map(l=>l.y+l.canvas.height))-bounds.y;}
    if(action.startsWith('distribute')&&layers.length<3)throw Error('Select at least three layers to distribute.');this.checkpoint('Align Layers');const move=(layer,x,y)=>this.positionLayer(layer,Math.round(x),Math.round(y));
    if(action.startsWith('distribute')){const horizontal=action==='distributeH',ordered=layers.slice().sort((a,b)=>(horizontal?a.x+a.canvas.width/2:a.y+a.canvas.height/2)-(horizontal?b.x+b.canvas.width/2:b.y+b.canvas.height/2)),first=ordered[0],last=ordered.at(-1),start=horizontal?first.x+first.canvas.width/2:first.y+first.canvas.height/2,end=horizontal?last.x+last.canvas.width/2:last.y+last.canvas.height/2;ordered.forEach((layer,index)=>{const center=start+(end-start)*index/(ordered.length-1);move(layer,horizontal?center-layer.canvas.width/2:layer.x,horizontal?layer.y:center-layer.canvas.height/2);});}
    else for(const layer of layers){let x=layer.x,y=layer.y;if(action==='left')x=bounds.x;if(action==='centerH')x=bounds.x+(bounds.w-layer.canvas.width)/2;if(action==='right')x=bounds.x+bounds.w-layer.canvas.width;if(action==='top')y=bounds.y;if(action==='centerV')y=bounds.y+(bounds.h-layer.canvas.height)/2;if(action==='bottom')y=bounds.y+bounds.h-layer.canvas.height;move(layer,x,y);}this.changed();
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
      if(alphaTarget){const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),level=(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)/255;context.globalCompositeOperation='destination-out';context.fillStyle=context.strokeStyle='#fff';if(width)context.stroke();else context.fill();context.globalCompositeOperation='source-over';context.globalAlpha=level;context.fillStyle=context.strokeStyle='#fff';if(width)context.stroke();else context.fill();}
      else{context.fillStyle=context.strokeStyle=color;if(width)context.stroke();else context.fill();}
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
    if(record){this.checkpoint('Free Transform');if(layer.kind==='smart')layer.smartOperations=[...(layer.smartOperations||[]),{type:'transform',settings:structuredClone(settings)}];}
    const transform=source=>{const output=surface(bounds.width,bounds.height),ctx=output.getContext('2d');ctx.imageSmoothingQuality='high';ctx.setTransform(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds.x,matrix[5]-bounds.y);ctx.drawImage(source,0,0);return output;};
    const editableText=layer.text,maskOrigin=layer.mask?this.maskOrigin(layer):null,mask=layer.maskLinked===false?null:this.alignedMask(layer);layer.canvas=transform(layer.canvas);if(mask){layer.mask=transform(mask);layer.maskOffsetX=layer.maskOffsetY=0;}else if(maskOrigin){layer.maskOffsetX=maskOrigin.x-bounds.x;layer.maskOffsetY=maskOrigin.y-bounds.y;}
    layer.x=bounds.x;layer.y=bounds.y;layer.text=editableText?{...editableText,matrix:multiplyAffine([matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds.x,matrix[5]-bounds.y],editableText.matrix||[1,0,0,1,0,0])}:null;layer.shape=null;this.changed();
  }
  transformTypeLayer(layer,settings){const activeId=this.activeId,linked=layer.maskLinked;this.activeId=layer.id;layer.maskLinked=true;try{this.transformLayer(settings,false,true);}finally{this.activeId=activeId;layer.maskLinked=linked;}}
  convertSmart(){const layer=this.active;if(!layer||this.isLocked(layer)||['adjustment','group','smart'].includes(layer.kind))return;this.checkpoint('Convert to Smart Object');layer.kind='smart';layer.smartSource=copyCanvas(layer.canvas);layer.smartOrigin={x:layer.x,y:layer.y};layer.smartOperations=[];layer.text=null;layer.shape=null;this.changed();}
  rebuildSmart(layer=this.active){
    if(layer?.kind!=='smart'||!layer.smartSource)return;const activeId=this.activeId,mask=layer.mask,maskOrigin=mask?this.maskOrigin(layer):null,maskOffsetX=layer.maskOffsetX||0,maskOffsetY=layer.maskOffsetY||0,selection=this.selection;this.activeId=layer.id;layer.canvas=copyCanvas(layer.smartSource);layer.x=layer.smartOrigin?.x||0;layer.y=layer.smartOrigin?.y||0;layer.mask=null;layer.kind=null;
    try{for(const operation of layer.smartOperations||[]){if(operation.enabled===false)continue;if(operation.type==='filter'){this.selection=offsetSelection(operation.selection,layer.x-(operation.selectionOrigin?.x||0),layer.y-(operation.selectionOrigin?.y||0));this.filter(operation.name,operation.amount,false);}else if(operation.type==='transform')this.transformLayer(operation.settings,false);else if(operation.type==='perspective')this.perspectiveLayer(operation.quad,false);}}
    finally{layer.kind='smart';layer.mask=mask;layer.maskOffsetX=maskOrigin&&layer.maskLinked===false?maskOrigin.x-layer.x:maskOffsetX;layer.maskOffsetY=maskOrigin&&layer.maskLinked===false?maskOrigin.y-layer.y:maskOffsetY;this.activeId=activeId;this.selection=selection;}this.changed();
  }
  rasterizeSmart(){const layer=this.active;if(layer?.kind!=='smart'||this.isLocked(layer))return;this.checkpoint('Rasterize Smart Object');layer.kind=null;layer.smartSource=null;layer.smartOperations=null;layer.fill=null;this.changed();}
  applyPerspectiveResult(result,quad,record=true){const layer=this.active;if(!layer||this.isLocked(layer))return;const maskOrigin=layer.mask?this.maskOrigin(layer):null;if(record){this.checkpoint('Perspective Transform');if(layer.kind==='smart')layer.smartOperations=[...(layer.smartOperations||[]),{type:'perspective',quad:structuredClone(quad)}];}const canvas=surface(result.image.width,result.image.height);canvas.getContext('2d').putImageData(result.image,0,0);layer.canvas=canvas;layer.x=result.x;layer.y=result.y;if(layer.maskLinked===false&&maskOrigin){layer.maskOffsetX=maskOrigin.x-layer.x;layer.maskOffsetY=maskOrigin.y-layer.y;}else{layer.maskOffsetX=layer.maskOffsetY=0;if(result.mask){const mask=surface(result.mask.width,result.mask.height);mask.getContext('2d').putImageData(result.mask,0,0);layer.mask=mask;}}layer.text=null;layer.shape=null;this.changed();}
  perspectiveLayer(quad,record=true){const layer=this.active;if(!layer||this.isLocked(layer))return;const read=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),result=perspectivePixels(read(layer.canvas),quad),mask=layer.mask?perspectivePixels(read(this.alignedMask(layer)),quad):null;this.applyPerspectiveResult({x:result.x,y:result.y,image:new ImageData(result.data,result.width,result.height),mask:mask?new ImageData(mask.data,mask.width,mask.height):null},quad,record);}
  transformSmartLayer(layer,settings){const activeId=this.activeId;this.activeId=layer.id;try{layer.smartOperations=[...(layer.smartOperations||[]),{type:'transform',settings:structuredClone(settings)}];this.transformLayer(settings,false,true);}finally{this.activeId=activeId;}}
  trim(){
    const {data}=this.composite().getContext('2d').getImageData(0,0,this.width,this.height);
    let left=this.width,top=this.height,right=-1,bottom=-1;
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)if(data[(y*this.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    if(right>=left)this.crop({x:left,y:top,w:right-left+1,h:bottom-top+1});
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
    bottom.canvas = output; bottom.x = bottom.y = 0; bottom.opacity = 1; bottom.blend = 'source-over'; bottom.mask = null; bottom.text = null;bottom.effects=null;
    this.layers.splice(index, 1); this.activeId = bottom.id; this.changed();
  }
  composite(parentId=null,ancestors=new Set()) {
    if(ancestors.has(parentId))throw Error('A layer group contains a circular reference.');const visited=new Set(ancestors);visited.add(parentId);
    const canvas = surface(this.width, this.height), context = canvas.getContext('2d');
    let clippingBase=null;
    for (const layer of this.layers.filter(item=>(item.parentId||null)===parentId)) {
      if (!layer.visible) {if(!layer.clipping)clippingBase=surface(this.width,this.height);continue;}
      if(layer.kind==='adjustment'&&layer.adjustment){
        const original=context.getImageData(0,0,this.width,this.height);
        const changed=new ImageData(new Uint8ClampedArray(original.data),this.width,this.height);
        adjustPixels(changed,layer.adjustment.name,layer.adjustment.amount);
        const mask=layer.mask?layer.mask.getContext('2d').getImageData(0,0,layer.mask.width,layer.mask.height):null;
        for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++){
          let weight=layer.opacity;
          if(mask){const mx=x-layer.x-(layer.maskOffsetX||0),my=y-layer.y-(layer.maskOffsetY||0);weight*=mx>=0&&my>=0&&mx<mask.width&&my<mask.height?mask.data[(my*mask.width+mx)*4+3]/255:0;}
          const i=(y*this.width+x)*4;for(let c=0;c<3;c++)original.data[i+c]=original.data[i+c]*(1-weight)+changed.data[i+c]*weight;
        }
        context.putImageData(original,0,0);continue;
      }
      const pixels=surface(this.width,this.height),paint=pixels.getContext('2d');
      if(layer.kind==='group'){
        paint.drawImage(this.composite(layer.id,visited),layer.x,layer.y);
        if(layer.mask){paint.globalCompositeOperation='destination-in';paint.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0),layer.y+(layer.maskOffsetY||0));}
        const rendered=renderEffects(pixels,layer.effects,layer.fillOpacity??1);if(rendered.canvas!==pixels){paint.globalCompositeOperation='copy';paint.drawImage(rendered.canvas,rendered.offsetX,rendered.offsetY);}
      }else {const rendered=this.renderLayer(layer);paint.drawImage(rendered.canvas,layer.x+rendered.offsetX,layer.y+rendered.offsetY);}
      if(layer.clipping){if(!clippingBase)continue;paint.globalCompositeOperation='destination-in';paint.drawImage(clippingBase,0,0);}else clippingBase=pixels;
      if(customBlends.has(layer.blend)){let seed=0;for(const character of layer.id)seed=Math.imul(seed,31)+character.charCodeAt(0)|0;compositeCustom(canvas,pixels,layer.blend,layer.opacity,seed);}
      else{context.globalAlpha = layer.opacity;context.globalCompositeOperation=layer.blend;context.drawImage(pixels,0,0);}context.globalAlpha=1;context.globalCompositeOperation='source-over';
    }
    return canvas;
  }
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
  modifySelection(mode,amount){if(!this.selection)return;this.checkpoint('Modify Selection');if(this.selection.kind==='alpha'){const pixels=this.selectionCoverage(),radius=Math.max(1,Math.min(1000,Math.round(amount)));let output;if(mode==='border'){const outside=extremePixels(pixels,this.width,this.height,radius,true),inside=extremePixels(pixels,this.width,this.height,radius,false);output=outside.map((value,i)=>Math.max(0,value-inside[i]));}else output=extremePixels(pixels,this.width,this.height,radius,mode==='expand');this.selection=alphaSelection(output,this.width,this.height);}else this.selection=modifySelection(this.selectionPixels(),this.width,this.height,amount,mode);this.dispatchEvent(new Event('change'));}
  featherSelection(radius){if(!this.selection)return;this.checkpoint('Feather Selection');const input=new Uint8ClampedArray(this.width*this.height);if(this.selection.kind==='alpha'){for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)input[y*this.width+x]=selectionWeight(this.selection,x,y)*255;}else{const values=this.selectionPixels();for(let i=0;i<input.length;i++)input[i]=values[i]*255;}this.selection=alphaSelection(featherPixels(input,this.width,this.height,radius),this.width,this.height);this.dispatchEvent(new Event('change'));}
  beginPixelEdit(canvas){return this.selection?.kind==='alpha'||canvas===this.active?.canvas&&this.isAlphaLocked()?copyCanvas(canvas):null;}
  finishPixelEdit(canvas,before,layer=this.active){
    const alphaLock=canvas===this.active?.canvas&&this.isAlphaLocked();if(!before||this.selection?.kind!=='alpha'&&!alphaLock)return;const ctx=canvas.getContext('2d'),original=before.getContext('2d').getImageData(0,0,before.width,before.height),edited=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4,w=this.selection?.kind==='alpha'?selectionWeight(this.selection,x+(layer?.x||0),y+(layer?.y||0)):1,oa=original.data[i+3]/255,ea=edited.data[i+3]/255,a=oa*(1-w)+ea*w;for(let c=0;c<3;c++)edited.data[i+c]=a?(original.data[i+c]*oa*(1-w)+edited.data[i+c]*ea*w)/a:alphaLock?original.data[i+c]:0;edited.data[i+3]=(alphaLock?oa:a)*255;}ctx.putImageData(edited,0,0);
  }
  editPixels(canvas,paint,layer=this.active){const origin=layer?.mask===canvas?this.maskOrigin(layer):layer,before=this.beginPixelEdit(canvas),ctx=canvas.getContext('2d');ctx.save();this.clip(ctx,origin);paint(ctx);ctx.restore();this.finishPixelEdit(canvas,before,origin);}
  setSelection(next,operation='replace'){
    const previous=this.selection;this.checkpoint('Selection');if(previous)this.previousSelection=structuredClone(previous);if(operation==='replace'){this.selection=next;this.dispatchEvent(new Event('change'));return;}
    if(previous?.kind==='alpha'||next?.kind==='alpha'){const a=previous?this.selectionCoverage():new Uint8ClampedArray(this.width*this.height);this.selection=next;const b=next?this.selectionCoverage():new Uint8ClampedArray(this.width*this.height);for(let i=0;i<a.length;i++)a[i]=operation==='subtract'?a[i]*(1-b[i]/255):operation==='intersect'?a[i]*b[i]/255:Math.max(a[i],b[i]);this.selection=alphaSelection(a,this.width,this.height);this.dispatchEvent(new Event('change'));return;}
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
    if(width*height>64000000)throw Error('Moving selected pixels exceeds the image size limit.');const next=surface(width,height),ctx=next.getContext('2d');ctx.drawImage(move.base,-left,-top);ctx.drawImage(move.floating,dx-left,dy-top);
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
  layerPixels(layer) {
    if (!layer.mask) return layer.canvas;
    const output=copyCanvas(layer.canvas),context=output.getContext('2d');
    context.globalCompositeOperation='destination-in';context.drawImage(layer.mask,layer.maskOffsetX||0,layer.maskOffsetY||0);return output;
  }
  renderLayer(layer){return renderEffects(this.layerPixels(layer),layer.effects,layer.fillOpacity??1);}
  addMask() {
    const layer=this.active;if(!layer||this.isLocked(layer))return;
    this.checkpoint('Add Layer Mask');layer.mask=surface(layer.canvas.width,layer.canvas.height);layer.maskOffsetX=layer.maskOffsetY=0;
    this.editPixels(layer.mask,context=>{context.fillStyle='#fff';context.fillRect(0,0,layer.mask.width,layer.mask.height);});this.changed();
  }
  removeMask(apply=false) {
    const layer=this.active;if(!layer?.mask||this.isLocked(layer))return;
    if(apply&&layer.kind==='adjustment')throw Error('Use Flatten Image to rasterize a masked adjustment.');
    if(apply&&layer.kind==='smart')throw Error('Rasterize the smart object before applying its mask.');
    if(apply&&layer.kind==='group')this.mergeGroup();
    this.checkpoint(apply?'Apply Layer Mask':'Delete Layer Mask');
    if(apply){layer.canvas=this.layerPixels(layer);layer.text=null;layer.shape=null;}layer.mask=null;layer.editMask=false;this.changed();
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
      return target.every((value,c)=>Math.abs(pixels[index*4+c]-value)<=tolerance);
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
  crop(rect = this.selection,deletePixels=true) {
    if (!rect) return;
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const width = Math.min(this.width - x, Math.round(rect.w)), height = Math.min(this.height - y, Math.round(rect.h));
    if (width < 1 || height < 1) return;
    this.checkpoint('Crop');
    for (const layer of this.layers) {
      if(layer.text){layer.x-=x;layer.y-=y;continue;}
      if(layer.kind==='smart'){layer.x-=x;layer.y-=y;layer.smartOrigin.x-=x;layer.smartOrigin.y-=y;layer.smartOperations=translateSmartOperations(layer.smartOperations,-x,-y);continue;}
      if(!deletePixels&&!['adjustment','group'].includes(layer.kind)){layer.x-=x;layer.y-=y;continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(width,height):null;if(mask)mask.getContext('2d').drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)-x,layer.y+(layer.maskOffsetY||0)-y);layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(width,height);layer.x=layer.y=0;continue;}
      const next = surface(width, height); next.getContext('2d').drawImage(this.layerPixels(layer), layer.x - x, layer.y - y);
      layer.canvas = next; layer.x = layer.y = 0; layer.mask = null; layer.text = null;layer.shape=null;
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(width,height);next.getContext('2d').drawImage(channel.canvas,-x,-y);channel.canvas=next;});this.guides=this.guides.map(guide=>({...guide,position:guide.position-(guide.axis==='vertical'?x:y)}));
    this.paths.forEach(path=>transformPath(path,(px,py)=>({x:px-x,y:py-y})));
    this.width = width; this.height = height; this.selection = null; this.changed();
  }
  resize(width, height, scalePixels = true) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 64000000) throw Error('Choose dimensions from 1 to 64 million pixels.');
    this.checkpoint(scalePixels ? 'Image Size' : 'Canvas Size');
    for (const layer of this.layers) {
      if(layer.text){if(scalePixels){const sx=width/this.width,sy=height/this.height;this.transformTypeLayer(layer,{scaleX:sx,scaleY:sy,x:layer.x*sx+(sx-1)*layer.canvas.width/2,y:layer.y*sy+(sy-1)*layer.canvas.height/2});}else{layer.x+=Math.round((width-this.width)/2);layer.y+=Math.round((height-this.height)/2);}continue;}
      if(layer.kind==='smart'){if(scalePixels){const sx=width/this.width,sy=height/this.height;this.transformSmartLayer(layer,{scaleX:sx,scaleY:sy,x:layer.x*sx+(sx-1)*layer.canvas.width/2,y:layer.y*sy+(sy-1)*layer.canvas.height/2});}else{const dx=Math.round((width-this.width)/2),dy=Math.round((height-this.height)/2);layer.x+=dx;layer.y+=dy;layer.smartOrigin.x+=dx;layer.smartOrigin.y+=dy;layer.smartOperations=translateSmartOperations(layer.smartOperations,dx,dy);}continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){let mask=null;if(layer.mask){mask=surface(width,height);const ctx=mask.getContext('2d');if(scalePixels)ctx.drawImage(layer.mask,(layer.x+(layer.maskOffsetX||0))*width/this.width,(layer.y+(layer.maskOffsetY||0))*height/this.height,layer.mask.width*width/this.width,layer.mask.height*height/this.height);else ctx.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)+Math.round((width-this.width)/2),layer.y+(layer.maskOffsetY||0)+Math.round((height-this.height)/2));}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(width,height);layer.x=layer.y=0;continue;}
      const next = surface(width, height), context = next.getContext('2d');
      context.imageSmoothingQuality = 'high';
      if (scalePixels) context.drawImage(this.layerPixels(layer), layer.x * width / this.width, layer.y * height / this.height,
        layer.canvas.width * width / this.width, layer.canvas.height * height / this.height);
      else context.drawImage(this.layerPixels(layer), layer.x + Math.round((width - this.width) / 2), layer.y + Math.round((height - this.height) / 2));
      layer.canvas = next; layer.x = layer.y = 0; layer.mask = null; layer.text = null;layer.shape=null;
    }
    const oldWidth=this.width,oldHeight=this.height;
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(width,height),ctx=next.getContext('2d');if(scalePixels)ctx.drawImage(channel.canvas,0,0,width,height);else ctx.drawImage(channel.canvas,Math.round((width-oldWidth)/2),Math.round((height-oldHeight)/2));channel.canvas=next;});this.guides=this.guides.map(guide=>({...guide,position:scalePixels?guide.position*(guide.axis==='vertical'?width/oldWidth:height/oldHeight):guide.position+Math.round((guide.axis==='vertical'?width-oldWidth:height-oldHeight)/2)}));
    this.paths.forEach(path=>transformPath(path,(x,y)=>scalePixels?{x:x*width/oldWidth,y:y*height/oldHeight}:{x:x+Math.round((width-oldWidth)/2),y:y+Math.round((height-oldHeight)/2)}));
    this.width = width; this.height = height; this.selection = null; this.changed();
  }
  rotate(turns = 1) {
    this.checkpoint('Image Rotation'); const width = this.width, height = this.height;
    for (const layer of this.layers) {
      if(layer.text){const w=layer.canvas.width,h=layer.canvas.height,cx=layer.x+w/2,cy=layer.y+h/2;this.transformTypeLayer(layer,{angle:turns*90,x:(turns>0?height-cy:cy)-w/2,y:(turns>0?cx:width-cx)-h/2});continue;}
      if(layer.kind==='smart'){const w=layer.canvas.width,h=layer.canvas.height,cx=layer.x+w/2,cy=layer.y+h/2;this.transformSmartLayer(layer,{angle:turns*90,x:(turns>0?height-cy:cy)-w/2,y:(turns>0?cx:width-cx)-h/2});continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(height,width):null;if(mask){const ctx=mask.getContext('2d');ctx.translate(height/2,width/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0)-width/2,layer.y+(layer.maskOffsetY||0)-height/2);}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(height,width);layer.x=layer.y=0;continue;}
      const next = surface(height, width), context = next.getContext('2d');
      context.translate(height / 2, width / 2); context.rotate(turns * Math.PI / 2);
      context.drawImage(this.layerPixels(layer), layer.x - width / 2, layer.y - height / 2);
      layer.canvas = next; layer.x = layer.y = 0; layer.mask = null; layer.text = null;layer.shape=null;
    }
    [...this.channels,...(this.quickMask?[this.quickMask]:[])].forEach(channel=>{const next=surface(height,width),ctx=next.getContext('2d');ctx.translate(height/2,width/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(channel.canvas,-width/2,-height/2);channel.canvas=next;});this.guides=this.guides.map(guide=>({axis:guide.axis==='vertical'?'horizontal':'vertical',position:turns>0?(guide.axis==='vertical'?guide.position:height-guide.position):(guide.axis==='vertical'?width-guide.position:guide.position)}));
    this.paths.forEach(path=>transformPath(path,(x,y)=>turns>0?{x:height-y,y:x}:{x:y,y:width-x}));
    this.width = height; this.height = width; this.selection = null; this.changed();
  }
  flip(horizontal) {
    this.checkpoint(horizontal ? 'Flip Horizontal' : 'Flip Vertical');
    for (const layer of this.layers) {
      if(layer.text){this.transformTypeLayer(layer,{scaleX:horizontal?-1:1,scaleY:horizontal?1:-1,x:horizontal?this.width-layer.x-layer.canvas.width:layer.x,y:horizontal?layer.y:this.height-layer.y-layer.canvas.height});continue;}
      if(layer.kind==='smart'){this.transformSmartLayer(layer,{scaleX:horizontal?-1:1,scaleY:horizontal?1:-1,x:horizontal?this.width-layer.x-layer.canvas.width:layer.x,y:horizontal?layer.y:this.height-layer.y-layer.canvas.height});continue;}
      if(layer.kind==='adjustment'||layer.kind==='group'){const mask=layer.mask?surface(this.width,this.height):null;if(mask){const ctx=mask.getContext('2d');ctx.translate(horizontal?this.width:0,horizontal?0:this.height);ctx.scale(horizontal?-1:1,horizontal?1:-1);ctx.drawImage(layer.mask,layer.x+(layer.maskOffsetX||0),layer.y+(layer.maskOffsetY||0));}layer.mask=mask;layer.maskOffsetX=layer.maskOffsetY=0;layer.canvas=surface(this.width,this.height);layer.x=layer.y=0;continue;}
      const next = surface(this.width, this.height), context = next.getContext('2d');
      context.translate(horizontal ? this.width : 0, horizontal ? 0 : this.height);
      context.scale(horizontal ? -1 : 1, horizontal ? 1 : -1); context.drawImage(this.layerPixels(layer), layer.x, layer.y);
      layer.canvas = next; layer.x = layer.y = 0; layer.mask = null; layer.text = null;layer.shape=null;
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
    if(name==='Blur'){const output=surface(source.width,source.height),paint=output.getContext('2d');paint.filter='blur('+Math.max(0,Number(amount)||0)+'px)';paint.drawImage(source,0,0);image=paint.getImageData(0,0,output.width,output.height);}else adjustPixels(image,name,amount);
    this.applyFilterPixels(image,name,amount,false);
  }
  applyFilterPixels(image,name,amount,record=true){
    if(name==='Color to Alpha'&&this.isAlphaLocked(this.paintLayer))throw Error('Unlock transparent pixels before applying Color to Alpha.');
    const layer=this.paintLayer;if(!layer||this.isLocked(layer))return;const maskTarget=layer.editMask&&layer.mask,target=maskTarget?layer.mask:layer.canvas;if(image.width!==target.width||image.height!==target.height)throw Error('The layer changed while applying this filter.');
    if(record){this.checkpoint(name);if(layer.kind==='smart'&&!maskTarget)layer.smartOperations=[...(layer.smartOperations||[]),{type:'filter',name,amount:structuredClone(amount),selection:this.selection?structuredClone(this.selection):null,selectionOrigin:{x:layer.x,y:layer.y},enabled:true}];}
    if(maskTarget){image=new ImageData(new Uint8ClampedArray(image.data),image.width,image.height);for(let i=0;i<image.data.length;i+=4){image.data[i+3]=(image.data[i]*.2126+image.data[i+1]*.7152+image.data[i+2]*.0722)*image.data[i+3]/255;image.data[i]=image.data[i+1]=image.data[i+2]=255;}}
    const output=surface(image.width,image.height);output.getContext('2d').putImageData(image,0,0);this.editPixels(target,ctx=>{ctx.clearRect(0,0,image.width,image.height);ctx.drawImage(output,0,0);},layer);if(!maskTarget){layer.text=null;layer.shape=null;}this.changed();
  }
  async project() {
    return JSON.stringify({format: 'chameleon-photo-editor', version: 1, width: this.width, height: this.height,resolution:this.resolution, name: this.name,activeId:this.activeId,selectedLayerIds:this.selectedLayerIds,channels:this.channels.map(({canvas,...channel})=>({...channel,pixels:canvas.toDataURL('image/png')})),guides:this.guides,paths:this.paths,activePathId:this.activePathId,
      layers: this.layers.map(({canvas, mask,smartSource, ...layer}) => ({...layer,smartSource:smartSource?smartSource.toDataURL('image/png'):null, mask:mask?mask.toDataURL('image/png'):null, pixels: canvas.toDataURL('image/png')}))},(key,value)=>ArrayBuffer.isView(value)?Array.from(value):value);
  }
  static async fromProject(text) {
    const data = JSON.parse(text);
    if (data.format !== 'chameleon-photo-editor' || data.version !== 1 || !Array.isArray(data.layers) || data.layers.length > 200 ||
      !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || data.width * data.height > 64000000) throw Error('Invalid Photo Editor project.');
    const doc = new EditorDocument(data.width, data.height, data.name);doc.resolution=Math.max(1,Math.min(10000,Number(data.resolution)||72));
    const layerIds=new Set(data.layers.map(entry=>entry.id));if(layerIds.size!==data.layers.length||data.layers.some(entry=>typeof entry.id!=='string'))throw Error('Invalid layer identifiers.');
    doc.guides=Array.isArray(data.guides)?data.guides.filter(guide=>['horizontal','vertical'].includes(guide.axis)&&Number.isFinite(guide.position)):[];
    doc.paths=Array.isArray(data.paths)?data.paths.filter(path=>Array.isArray(path.nodes)&&path.nodes.length<=10000&&path.nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y))).map(path=>structuredClone(path)):[];
    doc.activePathId=doc.paths.some(path=>path.id===data.activePathId)?data.activePathId:null;
    for (const entry of data.layers) {
      if (!/^data:image\/png;base64,/.test(entry.pixels)) throw Error('Invalid layer image.');
      const image = await loadImage(entry.pixels);
      const layer = doc.addLayer(String(entry.name || 'Layer'), image, false);
      layer.id=entry.id;layer.parentId=layerIds.has(entry.parentId)?entry.parentId:null;layer.clipping=Boolean(entry.clipping);if(entry.kind==='group'){layer.kind='group';layer.collapsed=Boolean(entry.collapsed);}doc.activeId=layer.id;
      layer.x = Number(entry.x) || 0; layer.y = Number(entry.y) || 0;layer.maskOffsetX=Number(entry.maskOffsetX)||0;layer.maskOffsetY=Number(entry.maskOffsetY)||0;layer.maskLinked=entry.maskLinked!==false;
      layer.visible = entry.visible !== false; layer.locked = Boolean(entry.locked);layer.lockAlpha=Boolean(entry.lockAlpha);layer.lockPosition=Boolean(entry.lockPosition);layer.fillOpacity=entry.fillOpacity==null?1:Math.max(0,Math.min(1,Number(entry.fillOpacity)||0));
      layer.opacity = Math.max(0, Math.min(1, Number(entry.opacity) || 0));
      layer.blend = String(entry.blend || 'source-over');
      if(entry.mask){if(!/^data:image\/png;base64,/.test(entry.mask))throw Error('Invalid layer mask.');layer.mask=copyCanvas(await loadImage(entry.mask));}
      if(entry.text&&typeof entry.text.value==='string')layer.text={...entry.text};
      if(entry.fill&&typeof entry.fill==='object')layer.fill=structuredClone(entry.fill);
      if(entry.shape&&typeof entry.shape==='object')layer.shape=structuredClone(entry.shape);
      if(entry.kind==='smart'&&entry.smartSource){if(!/^data:image\/png;base64,/.test(entry.smartSource))throw Error('Invalid smart object source.');layer.kind='smart';layer.smartSource=copyCanvas(await loadImage(entry.smartSource));layer.smartOrigin={x:Number(entry.smartOrigin?.x)||0,y:Number(entry.smartOrigin?.y)||0};layer.smartOperations=Array.isArray(entry.smartOperations)?structuredClone(entry.smartOperations):[];}
      if(entry.effects&&typeof entry.effects==='object')layer.effects=structuredClone(entry.effects);
      if(entry.kind==='adjustment'&&entry.adjustment){layer.kind='adjustment';layer.adjustment=structuredClone(entry.adjustment);}
    }
    if(Array.isArray(data.channels))for(const entry of data.channels.slice(0,100)){if(!/^data:image\/png;base64,/.test(entry.pixels))throw Error('Invalid alpha channel.');const canvas=copyCanvas(await loadImage(entry.pixels));if(canvas.width!==doc.width||canvas.height!==doc.height)throw Error('Invalid alpha channel dimensions.');doc.channels.push({id:String(entry.id),name:String(entry.name||'Alpha Channel'),canvas});}
    for(const layer of doc.layers){const visited=new Set([layer.id]);let parentId=layer.parentId;while(parentId){if(visited.has(parentId)||visited.size>30)throw Error('Invalid layer group hierarchy.');visited.add(parentId);const parent=doc.layers.find(item=>item.id===parentId);if(parent?.kind!=='group')throw Error('Invalid layer group parent.');parentId=parent.parentId;}}
    if(doc.layers.some(layer=>layer.id===data.activeId))doc.activeId=data.activeId;doc.selectedLayerIds=Array.isArray(data.selectedLayerIds)?data.selectedLayerIds.filter(id=>doc.layers.some(layer=>layer.id===id)):doc.activeId?[doc.activeId]:[];
    doc.dirty = false; return doc;
  }
}
export function loadImage(url) {
  return new Promise((resolve, reject) => {const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(Error('Unable to decode image.')); image.src = url;});
}
