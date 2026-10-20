import {labBytesToSrgb} from './lab-color.js';
import {levelsChannel} from './levels.js';
import {layerMatrix,transformedBounds,affinePoint} from './transforms.js';
import {quadMapping} from './perspective.js';
import {createStyleWarp,warpStyles} from './warp-presets.js';
import {brightnessContrastSettings} from './brightness-contrast.js';
import {curvePoints} from './curve-points.js';
// Placement, warp and smart-filter mapping for PSD SoLd records.
// Geometry follows PhotoCraft crates/geom/src/warp.rs and crates/io/src/blocks.rs
// placed_frame / corners, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Filter names follow the filters ag-psd parses and this editor already applies.
const presetStyles=new Set(warpStyles.map(([id])=>id));
const fromPSD=Object.fromEntries([['normal','source-over'],['dissolve','dissolve'],['darken','darken'],['multiply','multiply'],['color burn','color-burn'],['linear burn','linear-burn'],['darker color','darker-color'],['lighten','lighten'],['screen','screen'],['color dodge','color-dodge'],['linear dodge','linear-dodge'],['lighter color','lighter-color'],['overlay','overlay'],['soft light','soft-light'],['hard light','hard-light'],['vivid light','vivid-light'],['linear light','linear-light'],['pin light','pin-light'],['hard mix','hard-mix'],['difference','difference'],['exclusion','exclusion'],['subtract','subtract'],['divide','divide'],['hue','hue'],['saturation','saturation'],['color','color'],['luminosity','luminosity']].map(([name,id])=>[name,id]));
const toPSD=Object.fromEntries(Object.entries(fromPSD).map(([name,id])=>[id,name]));
const canvasBlends=new Set(['source-over','darken','multiply','color-burn','lighten','screen','color-dodge','overlay','hard-light','difference','exclusion','hue','saturation','color','luminosity']);
const customBlendIds=new Set(['dissolve','linear-burn','darker-color','linear-dodge','lighter-color','soft-light','vivid-light','linear-light','pin-light','hard-mix','subtract','divide']);
const corners=frame=>[{x:frame.x,y:frame.y},{x:frame.x+frame.width,y:frame.y},{x:frame.x+frame.width,y:frame.y+frame.height},{x:frame.x,y:frame.y+frame.height}];
const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
export function unitNumber(value){if(typeof value==='number'&&Number.isFinite(value))return value;if(value&&typeof value.value==='number'&&Number.isFinite(value.value))return value.value;return null;}
const bernstein=t=>{const s=1-t;return[s*s*s,3*s*s*t,3*s*t*t,t*t*t];};
function locate(knots,u){const n=knots.length-1,x=Math.max(0,Math.min(1,u));let i=0;while(i+1<n&&x>knots[i+1])i++;const span=knots[i+1]-knots[i];return[i,span>0?(x-knots[i])/span:0];}
export function meshPoint(mesh,s,t){
  const [pi,a]=locate(mesh.us,s),[pj,b]=locate(mesh.vs,t),bu=bernstein(a),bv=bernstein(b),nx=3*(mesh.us.length-1)+1;let x=0,y=0;
  for(let row=0;row<4;row++)for(let column=0;column<4;column++){const point=mesh.points[(3*pj+row)*nx+3*pi+column],weight=bu[column]*bv[row];x+=point.x*weight;y+=point.y*weight;}
  return{x,y};
}
function knots(slices,patches,size){
  if(!slices?.length)return Array.from({length:patches+1},(_,index)=>index/patches);
  if(slices.length!==patches+1||slices.some(value=>!Number.isFinite(value)))return null;
  const span=slices.at(-1)-slices[0];if(!(span>0)||slices.some((value,index)=>index&&value<=slices[index-1]))return null;
  return slices.map(value=>(value-slices[0])/span);
}
function boxOf(points){const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y)),right=Math.max(...points.map(point=>point.x)),bottom=Math.max(...points.map(point=>point.y));return{x,y,width:right-x,height:bottom-y};}
function sourceFrame(width,height){return{x:0,y:0,width,height};}
function boundsMatchSource(bounds,width,height){return Math.abs(bounds.x)<.51&&Math.abs(bounds.y)<.51&&Math.abs(bounds.width-width)<.51&&Math.abs(bounds.height-height)<.51;}
function warpBounds(warp,width,height){
  const bounds=warp?.bounds,value=key=>unitNumber(bounds?.[key]);
  if(!bounds)return sourceFrame(width,height);
  const left=value('left'),top=value('top'),right=value('right'),bottom=value('bottom');
  if(![left,top,right,bottom].every(item=>item!=null)||!(right>left)||!(bottom>top))return null;
  return{x:left,y:top,width:right-left,height:bottom-top};
}
function identityGrid(points,width,height){
  return points.length===16&&points.every((point,index)=>Math.abs(point.x-(index%4)*width/3)<1e-3&&Math.abs(point.y-Math.floor(index/4)*height/3)<1e-3);
}
function meshFromWarp(warp,width,height){
  const points=warp.customEnvelopeWarp?.meshPoints;if(!Array.isArray(points)||points.some(point=>!finitePoint(point)))return null;
  const columns=warp.deformNumCols||1,rows=warp.deformNumRows||1;
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||columns>64||rows<1||rows>64)return null;
  if(points.length!==(3*columns+1)*(3*rows+1))return null;
  const us=knots(warp.customEnvelopeWarp.quiltSliceX,columns,width),vs=knots(warp.customEnvelopeWarp.quiltSliceY,rows,height);
  if(!us||!vs)return null;
  return{us,vs,points:points.map(point=>({x:point.x,y:point.y}))};
}
export function describeWarp(placed){
  const width=unitNumber(placed?.width),height=unitNumber(placed?.height),warp=placed?.warp;
  if(!(width>0)||!(height>0))return{live:false,identity:false,reason:'The placed layer has no source size.'};
  if(!warp||warp.style==='none'||warp.style==null)return{live:true,identity:true,frame:sourceFrame(width,height)};
  const bounds=warpBounds(warp,width,height);if(!bounds)return{live:false,identity:false,reason:'The warp bounds cannot be read.'};
  if(presetStyles.has(warp.style)){
    if(!boundsMatchSource(bounds,width,height))return{live:false,identity:false,reason:'A style warp whose bounds differ from the source is kept as the stored preview.'};
    const bend=unitNumber(warp.value)??0,horizontal=unitNumber(warp.perspective)??0,vertical=unitNumber(warp.perspectiveOther)??0,axis=warp.rotate==='vertical'?'vertical':'horizontal';
    if(!createStyleWarp({warpStyle:warp.style,warpBend:bend,warpHorizontal:horizontal,warpVertical:vertical,warpAxis:axis},{x:bounds.x,y:bounds.y,w:bounds.width,h:bounds.height}))return{live:true,identity:true,frame:sourceFrame(width,height)};
    return{live:true,identity:false,frame:sourceFrame(width,height),spec:{style:warp.style,bend,horizontal,vertical,axis,bounds,frame:sourceFrame(width,height),psdWarp:warp}};
  }
  if(warp.style!=='custom')return{live:false,identity:false,reason:'Warp style "'+warp.style+'" is kept as the stored preview.'};
  const mesh=meshFromWarp(warp,width,height);if(!mesh)return{live:false,identity:false,reason:'The custom or quilt warp mesh does not match its patch count and is kept as the stored preview.'};
  if(boundsMatchSource(bounds,width,height)&&identityGrid(mesh.points,width,height))return{live:true,identity:true,frame:sourceFrame(width,height)};
  const frame=mesh.points.length===16?boxOf(mesh.points):sourceFrame(width,height);
  if(!(frame.width>1e-6)||!(frame.height>1e-6)||!Object.values(frame).every(Number.isFinite))return{live:false,identity:false,reason:'The custom warp has an empty control box.'};
  return{live:true,identity:false,frame,spec:{mesh,frame,domain:bounds,psdWarp:warp}};
}
export function warpOperation(description,quad){return{type:'warpPlace',quad:quad.map(point=>({x:point.x,y:point.y})),...description.spec};}
const immediate={average:'Average',blur:'Blur','blur more':'Blur More',despeckle:'Despeckle',facet:'Facet',fragment:'Fragment',sharpen:'Sharpen','sharpen edges':'Sharpen Edges','sharpen more':'Sharpen More','find edges':'Find Edges',solarize:'Solarize','ntsc colors':'NTSC Colors',invert:'Invert'};
function filterBlend(item){
  const blend=fromPSD[item.blendMode]||(item.blendMode==null?'source-over':null),opacity=item.opacity==null?1:item.opacity;
  if(!blend||!(canvasBlends.has(blend)||customBlendIds.has(blend))||!Number.isFinite(opacity)||opacity<0||opacity>1)return null;
  return{blend,opacity};
}
function replayAmount(item){
  const filter=item.filter||{},radius=()=>unitNumber(filter.radius);
  switch(item.type){
    case 'gaussian blur':case 'box blur':case 'median':case 'mosaic':case 'high pass':case 'maximum':case 'minimum':{const value=item.type==='mosaic'?unitNumber(filter.cellSize):radius();return value==null?null:value;}
    case 'motion blur':{const distance=unitNumber(filter.distance),angle=unitNumber(filter.angle);return distance==null||angle==null?null:{amount:distance,angle};}
    case 'radial blur':return Number.isFinite(filter.amount)&&['spin','zoom'].includes(filter.method)&&['draft','good','best'].includes(filter.quality)?{amount:filter.amount,method:filter.method,quality:filter.quality}:null;
    case 'surface blur':{const value=radius();return value==null||!Number.isFinite(filter.threshold)?null:{radius:value,threshold:filter.threshold};}
    case 'smart blur':{const mode={normal:'normal','edge only':'edgeOnly','overlay edge':'overlayEdge'}[filter.mode];return unitNumber(filter.radius)==null||!Number.isFinite(filter.threshold)||!mode||!['low','medium','high'].includes(filter.quality)?null:{radius:unitNumber(filter.radius),threshold:filter.threshold,quality:filter.quality,mode};}
    case 'unsharp mask':{const value=radius();return value==null||!Number.isFinite(filter.amount)||!Number.isFinite(filter.threshold)?null:{amount:filter.amount*100,radius:value,threshold:filter.threshold};}
    case 'add noise':return Number.isFinite(filter.amount)&&['uniform','gaussian'].includes(filter.distribution)?{amount:filter.amount*100,distribution:filter.distribution,monochromatic:Boolean(filter.monochromatic),seed:Number.isFinite(filter.randomSeed)?filter.randomSeed:0}:null;
    case 'emboss':return['angle','height','amount'].every(key=>Number.isFinite(filter[key]))?{angle:filter.angle,height:filter.height,amount:filter.amount}:null;
    case 'brightness/contrast':{const amount={brightness:filter.brightness??0,contrast:filter.contrast??0,legacy:Boolean(filter.useLegacy)};try{brightnessContrastSettings(amount);}catch{return null;}return amount;}
    case 'shadows/highlights':return {};
    case 'levels':{
      const amount={...levelsChannel(),channels:{}};
      try{for(const adjustment of filter.adjustments||[]){if(adjustment.channels?.length!==1)return null;const readPair=(pair,fallback)=>pair==null?fallback:Array.isArray(pair)&&pair.length===2?pair:null,input=readPair(adjustment.input,[0,255]),output=readPair(adjustment.output,[0,255]);if(!input||!output)return null;const channel=levelsChannel({black:input[0],white:input[1],gamma:adjustment.gamma??1,outputBlack:output[0],outputWhite:output[1]}),key=adjustment.channels[0];if(key==='composite')Object.assign(amount,channel);else if(['red','green','blue'].includes(key))amount.channels[key]=channel;else return null;}}catch{return null;}return amount;
    }
    case 'curves':{
      const settings={points:[[0,0],[255,255]],channels:{}};
      for(const adjustment of filter.adjustments||[]){
        if(adjustment.values||!adjustment.curve||adjustment.channels?.length!==1)return null;
        const points=adjustment.curve.map(point=>[point.x,point.y]);try{curvePoints(points);}catch{return null;}
        const channel=adjustment.channels[0];if(channel==='composite')settings.points=points;else if(['red','green','blue'].includes(channel))settings.channels[channel]=points;else return null;
      }
      return settings;
    }
    default:if(!immediate[item.type])return null;if(item.type==='blur')return .6;if(item.type==='solarize')return 128;return 1;
  }
}
const filterNames={'shadows/highlights':'Shadows/Highlights',levels:'Levels','gaussian blur':'Blur','box blur':'Box Blur','motion blur':'Motion Blur','radial blur':'Radial Blur','surface blur':'Surface Blur','smart blur':'Smart Blur','unsharp mask':'Unsharp Mask','add noise':'Add Noise',median:'Median',mosaic:'Mosaic','high pass':'High Pass',maximum:'Maximum',minimum:'Minimum',emboss:'Emboss','brightness/contrast':'Brightness/Contrast',curves:'Curves'};
export function describeFilters(placed){
  const stack=placed?.filter;if(!stack)return{live:true,enabled:true,operations:[],notes:[]};
  const operations=[],notes=[];let live=true;
  for(const item of stack.list||[]){
    const mixing=filterBlend(item),amount=mixing?replayAmount(item):null,name=filterNames[item.type]||immediate[item.type]||item.name||item.type||'Smart Filter',replay=Boolean(mixing&&amount!=null);
    if(!replay)live=false;
    operations.push({type:'filter',name,amount:amount??1,enabled:item.enabled!==false,opacity:mixing?.opacity??1,blend:mixing?.blend||'source-over',psd:item,replay});
  }
  if(!live)notes.push('One or more smart filters cannot be rerendered. The stored preview is kept and the parsed filter list is written back on export.');
  return{live,enabled:stack.enabled!==false,operations,notes};
}
function newFilterItem(type,name,filter){if(filter&&Object.values(filter).some(value=>value?.units==='Pixels'&&!Number.isFinite(value.value)))return null;return{type,name,opacity:1,blendMode:'normal',enabled:true,hasOptions:filter!=null,foregroundColor:{r:0,g:0,b:0},backgroundColor:{r:255,g:255,b:255},filter};}
export function nativeFilterOrder(layer){let filterSeen=false;for(const operation of layer.smartOperations||[]){if(operation.enabled===false)continue;if(operation.type==='filter'){if(operation.selection)return false;filterSeen=true;}else if(filterSeen)return false;}return true;}
export function exportFilterStack(layer){
  const operations=(layer.smartOperations||[]).filter(operation=>operation.type==='filter');
  const stored=layer.smartPsd?.filter;if(!operations.length)return layer.smartDocument||!stored?null:{...stored,enabled:layer.smartFiltersEnabled!==false,...(layer.smartFilterMask?{maskEnabled:layer.smartFilterMask.enabled!==false,maskLinked:Boolean(layer.smartFilterMask.linked),maskExtendWithWhite:layer.smartFilterMask.extendWhite!==false}:{})};
  const list=[];
  for(const operation of operations){
    if(operation.psd?.type){if(!toPSD[operation.blend||'source-over'])return false;list.push({...operation.psd,enabled:operation.enabled!==false,opacity:operation.opacity??operation.psd.opacity??1,blendMode:toPSD[operation.blend||'source-over']});continue;}
    const amount=operation.amount,item=exportedFilter(operation.name,amount);
    if(!item)return false;
    list.push({...item,enabled:operation.enabled!==false,opacity:operation.opacity??1,blendMode:toPSD[operation.blend||'source-over']||item.blendMode});
  }
  return{enabled:layer.smartFiltersEnabled!==false,validAtPosition:true,maskEnabled:layer.smartFilterMask?layer.smartFilterMask.enabled!==false:true,maskLinked:Boolean(layer.smartFilterMask?.linked),maskExtendWithWhite:layer.smartFilterMask?.extendWhite!==false,list};
}
function exportedFilter(name,amount){
  const pixel=value=>({units:'Pixels',value:Number(value)});
  const number=typeof amount==='object'?amount.amount:amount,radius=typeof amount==='object'?amount.radius??amount.amount:amount;
  switch(name){
    case 'Blur':return newFilterItem('gaussian blur','Gaussian Blur',{radius:pixel(number)});
    case 'Box Blur':return newFilterItem('box blur','Box Blur',{radius:pixel(number)});
    case 'Motion Blur':return newFilterItem('motion blur','Motion Blur',{angle:amount.angle||0,distance:pixel(number)});
    case 'Radial Blur':return newFilterItem('radial blur','Radial Blur',{amount:number,method:amount.method,quality:amount.quality});
    case 'Surface Blur':return newFilterItem('surface blur','Surface Blur',{radius:pixel(amount.radius),threshold:amount.threshold});
    case 'Smart Blur':return newFilterItem('smart blur','Smart Blur',{radius:amount.radius,threshold:amount.threshold,quality:amount.quality,mode:amount.mode==='edgeOnly'?'edge only':amount.mode==='overlayEdge'?'overlay edge':'normal'});
    case 'Unsharp Mask':return newFilterItem('unsharp mask','Unsharp Mask',{amount:(amount.amount||0)/100,radius:pixel(amount.radius),threshold:amount.threshold||0});
    case 'Add Noise':return newFilterItem('add noise','Add Noise',{amount:(amount.amount??number)/100,distribution:amount.distribution||'uniform',monochromatic:Boolean(amount.monochromatic),randomSeed:amount.seed||0});
    case 'Median':return newFilterItem('median','Median',{radius:pixel(radius)});
    case 'Mosaic':return newFilterItem('mosaic','Mosaic',{cellSize:pixel(number)});
    case 'High Pass':return newFilterItem('high pass','High Pass',{radius:pixel(number)});
    case 'Maximum':return newFilterItem('maximum','Maximum',{radius:pixel(number)});
    case 'Minimum':return newFilterItem('minimum','Minimum',{radius:pixel(number)});
    case 'Emboss':return newFilterItem('emboss','Emboss',{angle:amount.angle,height:amount.height,amount:amount.amount});
    case 'Shadows/Highlights':{
      const defaults={shadowAmount:35,shadowTone:50,shadowRadius:30,highlightAmount:0,highlightTone:50,highlightRadius:30,color:20,midtone:0,blackClip:.01,whiteClip:.01};
      if(!amount||typeof amount!=='object'||Object.entries(amount).some(([key,value])=>!(key in defaults)||Number(value)!==defaults[key]))return null;
      return newFilterItem('shadows/highlights','Shadows/Highlights');
    }
    case 'Levels':{
      try{let channels=amount.channels||{};if(typeof channels==='string')channels=JSON.parse(channels);const adjustments=['composite','red','green','blue'].map(key=>{const value=levelsChannel(key==='composite'?amount:channels[key]);return{channels:[key],input:[value.black,value.white],gamma:value.gamma,output:[value.outputBlack,value.outputWhite]};});return newFilterItem('levels','Levels',{adjustments});}catch{return null;}
    }
    case 'Curves':{
      try{let channels=amount.channels||{};if(typeof channels==='string')channels=JSON.parse(channels);const master=curvePoints(amount.points),rows=['red','green','blue'].map(key=>({key,points:curvePoints(channels[key])}));if(!master.length&&!rows.some(row=>row.points.length))return null;const encode=points=>points.map(([x,y])=>({x,y})),adjustments=[{channels:['composite'],curve:encode(master.length?master:[[0,0],[255,255]])},...rows.filter(row=>row.points.length).map(row=>({channels:[row.key],curve:encode(row.points)}))];return newFilterItem('curves','Curves',{presetKind:'custom',adjustments});}catch{return null;}
    }
    case 'Brightness/Contrast':return newFilterItem('brightness/contrast','Brightness/Contrast',{brightness:amount.brightness||0,contrast:amount.contrast||0,useLegacy:Boolean(amount.legacy)});
    case 'Solarize':return Number(number)===128?newFilterItem('solarize','Solarize'):null;
    case 'Average':case 'Blur More':case 'Despeckle':case 'Facet':case 'Fragment':case 'Sharpen':case 'Sharpen Edges':case 'Sharpen More':case 'Find Edges':case 'NTSC Colors':case 'Invert':return newFilterItem(name.toLowerCase(),name);
    default:return null;
  }
}
export function exportWarp(layer){return (layer.smartOperations||[]).find(operation=>operation.type==='warpPlace')?.psdWarp||null;}
export function placeFilterMask(record,mask){
  if(!record||!mask?.canvas)return record;
  const width=mask.canvas.width,height=mask.canvas.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return record;
  const pixels=mask.canvas.getContext('2d').getImageData(0,0,width,height).data,plane=new Uint8Array(width*height);
  for(let i=0;i<plane.length;i++)plane[i]=pixels[i*4+3];
  const left=Math.round(mask.x)||0,top=Math.round(mask.y)||0;
  return {...record,extra:{...(record.extra||{}),left,top,right:left+width,bottom:top+height,compressionMode:0,data:plane}};
}
export function createFilterRecord(id,base,filtered,mask){
  const left=Math.floor(Math.min(base.x,filtered.x)),top=Math.floor(Math.min(base.y,filtered.y)),right=Math.ceil(Math.max(base.x+base.canvas.width,filtered.x+filtered.canvas.width)),bottom=Math.ceil(Math.max(base.y+base.canvas.height,filtered.y+filtered.canvas.height)),width=right-left,height=bottom-top;
  if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The smart-filter cache exceeds the image size limit.');
  const pixels=base.canvas.getContext('2d').getImageData(0,0,base.canvas.width,base.canvas.height).data,planes=Array.from({length:4},()=>new Uint8Array(width*height));
  planes[0].fill(255);planes[1].fill(255);planes[2].fill(255);
  for(let y=0;y<base.canvas.height;y++)for(let x=0;x<base.canvas.width;x++){const source=(y*base.canvas.width+x)*4,index=(Math.round(base.y-top)+y)*width+Math.round(base.x-left)+x,a=pixels[source+3];planes[3][index]=a;if(a)for(let c=0;c<3;c++)planes[c][index]=pixels[source+c];}
  const channels=Array(26).fill(undefined);for(let c=0;c<4;c++)channels[c===3?25:c]={compressionMode:0,data:planes[c]};
  const ml=Math.floor(Math.min(left,mask?.canvas?mask.x:left)),mt=Math.floor(Math.min(top,mask?.canvas?mask.y:top)),mr=Math.ceil(Math.max(right,mask?.canvas?mask.x+mask.canvas.width:right)),mb=Math.ceil(Math.max(bottom,mask?.canvas?mask.y+mask.canvas.height:bottom)),mw=mr-ml,mh=mb-mt;
  if(mw>32767||mh>32767||mw*mh>64000000)throw Error('The smart-filter mask exceeds the image size limit.');
  const data=new Uint8Array(mw*mh);data.fill(mask?.extendWhite===false?0:255);
  if(mask?.canvas){const values=mask.canvas.getContext('2d').getImageData(0,0,mask.canvas.width,mask.canvas.height).data;for(let y=0;y<mask.canvas.height;y++)for(let x=0;x<mask.canvas.width;x++)data[(Math.round(mask.y-mt)+y)*mw+Math.round(mask.x-ml)+x]=values[(y*mask.canvas.width+x)*4+3];}
  return{id,left,top,right,bottom,depth:8,channels,extra:{left:ml,top:mt,right:mr,bottom:mb,compressionMode:0,data}};
}
export function isGuid(value){return typeof value==='string'&&/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);}
function unpackRow(data,offset,count,width){
  const out=new Uint8Array(width);let input=offset,output=0;
  while(output<width){if(input>=offset+count)return null;const code=data[input++];if(code===128)continue;if(code<128){const length=code+1;if(input+length>offset+count||output+length>width)return null;out.set(data.subarray(input,input+length),output);input+=length;output+=length;}else{const length=257-code;if(input>=offset+count||output+length>width)return null;out.fill(data[input++],output,output+length);output+=length;}}
  while(input<offset+count)if(data[input++]!==128)return null;
  return{out,next:input};
}
// FEid planes convert through the same8-bit working colour paths as PSD layer import.
export function unfilteredRGBRecord(record,mode=3){
  const count={1:1,3:3,4:4,8:1,9:3}[mode];if(!count||!record||!Array.isArray(record.channels)||record.channels.length<count+1)return null;
  const width=record.right-record.left,height=record.bottom-record.top;
  if(![record.left,record.top,record.right,record.bottom].every(Number.isInteger))return null;
  const planes=Array.from({length:count},(_,index)=>decodePlane(record.channels[index],width,height,record.depth));
  if(planes.some(plane=>!plane))return null;
  const slot=record.channels.at(-1),alpha=slot?decodePlane(slot,width,height,record.depth):null;if(slot&&!alpha)return null;
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)data[i*4+c]=count===1?planes[0][i]:mode===4?Math.round(planes[c][i]*planes[3][i]/255):planes[c][i];data[i*4+3]=alpha?alpha[i]:255;}
  if(mode===9)labBytesToSrgb(data);
  return{data,width,height,x:record.left,y:record.top};
}
export function decodePlane(channel,width,height,depth=8){
  if(!channel||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>32767||height>32767||width*height>64000000||![8,16,32].includes(depth))return null;
  const bytesPer=depth/8,rowBytes=width*bytesPer,total=rowBytes*height;let data=null;
  if(channel.data instanceof Uint8Array)data=channel.data;
  else if(ArrayBuffer.isView(channel.data))data=new Uint8Array(channel.data.buffer,channel.data.byteOffset,channel.data.byteLength);
  else if(Array.isArray(channel.data)&&channel.data.length<=total+Math.ceil(rowBytes/128)*height+height*4+65536&&channel.data.every(value=>Number.isInteger(value)&&value>=0&&value<=255))data=Uint8Array.from(channel.data);
  if(!data)return null;let decoded;
  if(channel.compressionMode===0){if(data.length<total)return null;decoded=data.subarray(0,total);}
  else if(channel.compressionMode===1){
    if(data.length<height*4)return null;const view=new DataView(data.buffer,data.byteOffset,data.byteLength),rows=[];let offset=height*4;
    for(let y=0;y<height;y++){const count=view.getUint32(y*4);if(offset+count>data.length)return null;const row=unpackRow(data,offset,count,rowBytes);if(!row)return null;rows.push(row.out);offset+=count;}
    decoded=new Uint8Array(total);rows.forEach((row,y)=>decoded.set(row,y*rowBytes));
  }else if(channel.compressionMode===2||channel.compressionMode===3){
    if(total>data.length*1032+64||!globalThis.pako?.Inflate)return null;
    try{decoded=new Uint8Array(total);let offset=0;const inflater=new globalThis.pako.Inflate({chunkSize:Math.min(65536,Math.max(1024,total))});inflater.onData=chunk=>{if(offset+chunk.length>total)throw Error('Filter-mask ZIP exceeds its expected size.');decoded.set(chunk,offset);offset+=chunk.length;};inflater.push(data,true);if(inflater.err||offset!==total)return null;}catch{return null;}
    if(channel.compressionMode===3){
      const view=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength),scratch=depth===32?new Uint8Array(rowBytes):null;
      for(let y=0;y<height;y++){const at=y*rowBytes;if(depth===16){for(let x=1;x<width;x++)view.setUint16(at+x*2,(view.getUint16(at+x*2)+view.getUint16(at+(x-1)*2))&65535);}else{for(let x=1;x<rowBytes;x++)decoded[at+x]=(decoded[at+x]+decoded[at+x-1])&255;if(depth===32){scratch.set(decoded.subarray(at,at+rowBytes));for(let x=0;x<width;x++)for(let c=0;c<4;c++)decoded[at+x*4+c]=scratch[c*width+x];}}}
    }
  }else return null;
  if(depth===8)return decoded;
  const plane=new Uint8Array(width*height),view=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength);
  for(let i=0;i<plane.length;i++){const value=depth===16?view.getUint16(i*2)/65535:view.getFloat32(i*4);plane[i]=Number.isFinite(value)?Math.round(Math.max(0,Math.min(1,value))*255):0;}return plane;
}

export function smartPlacement(layer){
  if(!layer.smartSource||layer.smartPsd&&typeof layer.smartDocument!=='string')return null;
  let frame={x:layer.smartOrigin?.x||0,y:layer.smartOrigin?.y||0,width:layer.smartSource.width,height:layer.smartSource.height},points=corners(frame),warped=false;
  for(const op of layer.smartOperations||[]){
    if(op.enabled===false)continue;
    if(op.type==='filter')continue;
    if(op.type==='warpPlace'){
      if(warped||!Array.isArray(op.quad)||op.quad.length!==4||op.quad.some(point=>!finitePoint(point)))return null;
      points=op.quad.map(point=>({x:point.x,y:point.y}));frame=boxOf(points);warped=true;continue;
    }
    if(warped)return null;
    if(op.type==='transform'){
      const matrix=layerMatrix({...frame,canvas:frame},op.settings);
      points=points.map(point=>affinePoint(matrix,point.x-frame.x,point.y-frame.y));
      frame=transformedBounds(matrix,frame.width,frame.height);
    }else if(op.type==='perspective'){
      const mapping=quadMapping(corners(frame),op.quad);
      points=points.map(point=>{const w=mapping[6]*point.x+mapping[7]*point.y+1;return{x:(mapping[0]*point.x+mapping[1]*point.y+mapping[2])/w,y:(mapping[3]*point.x+mapping[4]*point.y+mapping[5])/w};});
      const box=boxOf(op.quad),x=Math.floor(box.x),y=Math.floor(box.y);frame={x,y,width:Math.ceil(box.x+box.width)-x,height:Math.ceil(box.y+box.height)-y};
    }else if(op.type==='resizePixels'){
      const {scaleX,scaleY,offsetX=0,offsetY=0}=op.settings;
      points=points.map(point=>({x:point.x*scaleX+offsetX,y:point.y*scaleY+offsetY}));
      const x=Math.floor(frame.x*scaleX),y=Math.floor(frame.y*scaleY);
      frame={x:x+offsetX,y:y+offsetY,width:Math.ceil((frame.x+frame.width)*scaleX)-x,height:Math.ceil((frame.y+frame.height)*scaleY)-y};
    }else return null;
  }
  const result=points.flatMap(point=>[point.x,point.y]);
  return result.every(Number.isFinite)?result:null;
}
