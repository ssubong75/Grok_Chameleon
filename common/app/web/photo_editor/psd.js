import {EditorDocument, surface} from './engine.js';
import {blendModes,customBlends} from './blend-modes.js';
const toPSD=Object.fromEntries(blendModes.slice(0,27).map(([id])=>[id,id==='source-over'?'normal':id.replaceAll('-',' ')]));toPSD.lighter='linear dodge';
const fromPSD=Object.fromEntries(Object.entries(toPSD).map(([id,name])=>[name,id]));fromPSD['pass through']='source-over';fromPSD['linear dodge']='linear-dodge';
export async function readDocument(bytes, name) {
  if(!window.agPsd)throw Error('PSD reader is unavailable.');
  const parsed=window.agPsd.readPsd(bytes,{skipThumbnail:true});
  if(parsed.width*parsed.height>64000000)throw Error('PSD exceeds the current 64 million pixel limit.');
  const result=new EditorDocument(parsed.width,parsed.height,name),notes=new Set();
  const resolution=parsed.imageResources?.resolutionInfo;if(resolution)result.resolution=resolution.horizontalResolution*(resolution.horizontalResolutionUnit==='PPCM'?2.54:1);
  if(parsed.bitsPerChannel&&parsed.bitsPerChannel!==8)throw Error('This JavaScript PSD path currently supports 8-bit documents only.');
  function visit(layers,parentId=null){for(const item of layers||[]){
    if(!item.canvas&&!item.children)continue;
    const layer=result.addLayer(item.name||'Layer',item.canvas||surface(parsed.width,parsed.height),false);
    layer.parentId=parentId;layer.clipping=Boolean(item.clipping);
    layer.x=item.children?0:item.left||0;layer.y=item.children?0:item.top||0;layer.opacity=item.opacity??1;layer.fillOpacity=item.fillOpacity??1;layer.visible=!item.hidden;layer.lockAlpha=Boolean(item.transparencyProtected||item.protected?.transparency);layer.lockPosition=Boolean(item.protected?.position);layer.locked=Boolean(item.protected?.composite&&item.protected?.transparency&&item.protected?.position);
    const blend=fromPSD[item.blendMode]||item.blendMode||'source-over';
    const context=surface(1,1).getContext('2d');context.globalCompositeOperation=blend;
    layer.blend=customBlends.has(blend)?blend:context.globalCompositeOperation;
    if(layer.blend!==blend)notes.add(`Unsupported blend mode: ${item.blendMode}.`);
    if(item.text||item.vectorMask||item.adjustment||item.effects||item.placedLayer)notes.add('Text, vector, adjustment, effects and smart-object content use their stored raster previews.');
    if(item.mask?.canvas&&!item.mask.disabled){const source=item.mask.canvas,mask=surface(layer.canvas.width,layer.canvas.height),ctx=mask.getContext('2d');ctx.fillStyle=item.mask.defaultColor===255?'#fff':'#000';ctx.fillRect(0,0,mask.width,mask.height);ctx.drawImage(source,(item.mask.left||0)-layer.x,(item.mask.top||0)-layer.y);const image=ctx.getImageData(0,0,mask.width,mask.height);for(let i=0;i<image.data.length;i+=4){image.data[i+3]=image.data[i];image.data[i]=image.data[i+1]=image.data[i+2]=255;}ctx.putImageData(image,0,0);layer.mask=mask;}
    if(item.children){layer.kind='group';layer.collapsed=!item.opened;if(item.blendMode==='pass through')notes.add('Pass-through groups currently composite as isolated groups.');visit(item.children,layer.id);}
  }}
  visit(parsed.children);
  if(!result.layers.length&&parsed.canvas)result.addLayer('Background',parsed.canvas,false);
  result.dirty=false;return {document:result,notes:[...notes]};
}
export function writeDocument(document) {
  if(!window.agPsd)throw Error('PSD writer is unavailable.');
  const imageResources={resolutionInfo:{horizontalResolution:document.resolution||72,horizontalResolutionUnit:'PPI',widthUnit:'Inches',verticalResolution:document.resolution||72,verticalResolutionUnit:'PPI',heightUnit:'Inches'}};
  if(document.layers.some(layer=>layer.kind==='adjustment'||!toPSD[layer.blend]))return window.agPsd.writePsd({width:document.width,height:document.height,imageResources,canvas:document.composite(),children:[{name:'Composite',canvas:document.composite()}]},{generateThumbnail:false});
  const makeLayer=layer=>{
    const hasEffects=layer.effects&&Object.values(layer.effects).some(effect=>effect?.enabled),rendered=hasEffects?document.renderLayer(layer):{canvas:layer.canvas,offsetX:0,offsetY:0};
    const item={name:layer.name,left:layer.x+rendered.offsetX,top:layer.y+rendered.offsetY,opacity:layer.opacity,fillOpacity:hasEffects?1:layer.fillOpacity??1,hidden:!layer.visible,blendMode:toPSD[layer.blend]||'normal',canvas:rendered.canvas,transparencyProtected:Boolean(layer.lockAlpha||layer.locked),protected:{transparency:Boolean(layer.lockAlpha||layer.locked),position:Boolean(layer.lockPosition||layer.locked),composite:Boolean(layer.locked)}};
    if(layer.mask&&!hasEffects){const canvas=surface(layer.mask.width,layer.mask.height),context=canvas.getContext('2d'),data=layer.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<data.data.length;i+=4){data.data[i]=data.data[i+1]=data.data[i+2]=data.data[i+3];data.data[i+3]=255;}context.putImageData(data,0,0);item.mask={left:layer.x+(layer.maskOffsetX||0),top:layer.y+(layer.maskOffsetY||0),defaultColor:0,canvas};}
    item.clipping=Boolean(layer.clipping);
    if(layer.kind==='group'){delete item.canvas;item.opened=!layer.collapsed;item.children=document.layers.filter(child=>child.parentId===layer.id).map(makeLayer);}
    return item;
  };
  const children=document.layers.filter(layer=>!layer.parentId).map(makeLayer);
  return window.agPsd.writePsd({width:document.width,height:document.height,imageResources,canvas:document.composite(),children},{generateThumbnail:false});
}
