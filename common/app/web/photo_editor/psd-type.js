import {typeMatrix,layoutType} from './text-layout.js';
import {warpStyles} from './warp-presets.js';
import {setTypeFont} from './styled-type.js';
import {multiplyAffine,inverseAffine} from './transforms.js';
import {normalizeTextRuns} from './rich-text.js';

const knownWarp=new Set(warpStyles.map(([id])=>id));
const hasUnsupportedWarp=text=>text.warpStyle&&text.warpStyle!=='none'&&!knownWarp.has(text.warpStyle);
const percent=value=>Math.max(-100,Math.min(100,num(value)));
const identity=[1,0,0,1,0,0],num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const toAlign={'justify-left':'justify','justify-center':'justifyCenter','justify-right':'justifyRight','justify-all':'justifyAll'},fromAlign=Object.fromEntries(Object.entries(toAlign).map(([a,b])=>[b,a]));
const rgb=color=>color&&['r','g','b'].every(key=>Number.isFinite(color[key]))?'#'+['r','g','b'].map(key=>Math.round(Math.max(0,Math.min(255,color[key]))).toString(16).padStart(2,'0')).join(''):null;
const psdColor=color=>({r:parseInt(color.slice(1,3),16),g:parseInt(color.slice(3,5),16),b:parseInt(color.slice(5,7),16)});
function signature(text){
  const {psdOriginal,psdUnsupported,matrix,angle,scaleX,scaleY,skew,...style}=text;
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return JSON.stringify(ordered(style));
}
const world=(text,layer)=>multiplyAffine([1,0,0,1,layer.x,layer.y],typeMatrix(text));
function unsupportedStyle(style,base,issues){
  if(style.fillColor&&!rgb(style.fillColor))issues.add('non-RGB text colors');
  if(style.fillColor?.a!=null&&style.fillColor.a!==255)issues.add('character opacity');
  if(style.strokeFlag||style.fillFlag===false)issues.add('text stroke or hidden text fill');
  if(style.fontBaseline)issues.add('superscript or subscript');
  if(style.characterDirection)issues.add('character direction overrides');
  if(style.fontSize!=null&&(style.fontSize<.1||style.fontSize>2000))issues.add('text size outside the current editor range');
  if(base)for(const key of ['leading','autoLeading'])if(style[key]!=null&&style[key]!==base[key])issues.add('per-character '+key);
}
function edgeNumber(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(value&&typeof value==='object'&&Number.isFinite(value.value)&&[undefined,'Pixels','Points','None'].includes(value.units))return value.value;
  return null;
}
function frameBounds(bounds){
  if(!bounds)return null;
  const left=edgeNumber(bounds.left),top=edgeNumber(bounds.top),right=edgeNumber(bounds.right),bottom=edgeNumber(bounds.bottom);
  if([left,top,right,bottom].some(value=>value==null)||!(right>left)||!(bottom>top))return null;
  return [left,top,right,bottom];
}
export function hasTextCurve(path){
  const points=path?.bezierCurve?.controlPoints;
  if(Array.isArray(points))return points.length>0;
  return Boolean(points&&typeof points==='object'&&Object.keys(points).length);
}
// PhotoCraft apply_txt2_frame: a Txt2 frame matrix and point-text anchor place the text when EngineData's PointBase stays at the origin.
export function txt2FrameTransform(data){
  const frame=data?.textPath;if(!frame||typeof frame!=='object')return null;
  const raw=frame.data?.frameMatrix,matrix=Array.isArray(raw)&&raw.length===6&&raw.every(Number.isFinite)?raw:identity;
  const anchor=Array.isArray(frame.name)&&frame.name.length===2&&frame.name.every(Number.isFinite)?frame.name:null,point=data.shapeType!=='box';
  const toText=multiplyAffine(matrix,point&&anchor?[1,0,0,1,anchor[0],anchor[1]]:identity);
  if(toText.every((value,index)=>Math.abs(value-identity[index])<1e-9)||Math.abs(toText[0]*toText[3]-toText[1]*toText[2])<=1e-9)return null;
  let origin=[0,0];
  if(!point){const box=data.boxBounds;if(!Array.isArray(box)||!box.slice(0,2).every(Number.isFinite))return null;origin=[box[0],box[1]];}
  const bounds=frameBounds(data.bounds);if(!bounds)return null;
  const [left,top,right,bottom]=bounds,inside=(x,y)=>x>=left-1&&x<=right+1&&y>=top-1&&y<=bottom+1;
  const moved=[toText[0]*origin[0]+toText[2]*origin[1]+toText[4],toText[1]*origin[0]+toText[3]*origin[1]+toText[5]];
  if(inside(origin[0],origin[1])||!inside(moved[0],moved[1]))return null;
  const base=Array.isArray(data.transform)&&data.transform.length===6&&data.transform.every(Number.isFinite)?data.transform:identity;
  return multiplyAffine(base,toText);
}
function editorStyle(style,base={}){
  const output={},size=num(style.fontSize,num(base.fontSize,48));
  if(style.font?.name)output.font=style.font.name;if(style.fontSize!=null)output.size=size;
  if(style.fillColor&&rgb(style.fillColor))output.color=rgb(style.fillColor);
  for(const [source,target]of [['fauxBold','bold'],['fauxItalic','italic'],['underline','underline'],['strikethrough','strike']])if(style[source]!=null)output[target]=Boolean(style[source]);
  if(style.tracking!=null||style.fontSize!=null)output.tracking=num(style.tracking,num(base.tracking))*size/1000;
  if(style.baselineShift!=null)output.baselineShift=num(style.baselineShift);
  if(style.horizontalScale!=null)output.glyphScaleX=num(style.horizontalScale,1);
  if(style.verticalScale!=null)output.glyphScaleY=num(style.verticalScale,1);
  if(style.fontCaps===1)output.caps='small';else if(style.fontCaps===2)output.caps='all';return output;
}
export function importPsdType(data,layer){
  if(!data||typeof data.text!=='string')return null;
  const curve=hasTextCurve(data.textPath),framed=txt2FrameTransform(data);
  if(framed)data={...data,transform:framed,textPath:curve?data.textPath:undefined};
  const issues=new Set(),style={...data.styleRuns?.[0]?.style,...data.style},paragraph={...data.paragraphStyleRuns?.[0]?.style,...data.paragraphStyle},size=Math.max(.1,Math.min(2000,num(style.fontSize,48))),matrix=data.transform||identity;
  if(!Array.isArray(matrix)||matrix.length!==6||!matrix.every(Number.isFinite))throw Error('Unsupported PSD text transform.');
  unsupportedStyle(style,null,issues);if(curve)issues.add('Photoshop text paths');if(data.warp?.style&&data.warp.style!=='none'&&!knownWarp.has(data.warp.style))issues.add('Photoshop text warp '+data.warp.style);if(data.paragraphStyleRuns?.length>1)issues.add('multiple paragraph styles');if(data.shapeType==='box'&&paragraph.autoHyphenate)issues.add('automatic hyphenation');
  const text={value:data.text.replace(/\r\n?/g,'\n'),font:style.font?.name||'Inter',size,color:rgb(style.fillColor)||'#000000',mode:data.shapeType==='box'?'paragraph':'point',orientation:data.orientation==='vertical'?'vertical':'horizontal',align:toAlign[paragraph.justification]||paragraph.justification||'left',direction:'ltr',kerning:style.autoKerning===false?'off':'metrics',
    x:0,y:0,boxWidth:400,boxHeight:300,tracking:num(style.tracking)*size/1000,leading:num(paragraph.autoLeading,1.2),leadingPx:style.autoLeading===false?Math.max(0,num(style.leading)):0,baselineShift:num(style.baselineShift),startIndent:num(paragraph.startIndent),endIndent:num(paragraph.endIndent),firstLineIndent:num(paragraph.firstLineIndent),spaceBefore:num(paragraph.spaceBefore),spaceAfter:num(paragraph.spaceAfter),bold:Boolean(style.fauxBold),italic:Boolean(style.fauxItalic),underline:Boolean(style.underline),strike:Boolean(style.strikethrough),angle:0,scaleX:num(style.horizontalScale,1)*100,scaleY:num(style.verticalScale,1)*100,skew:0,pathOffset:0,pathBaseline:0,pathReverse:false,pathFlip:false,warpStyle:'none',warpAxis:'horizontal',warpBend:50,warpHorizontal:0,warpVertical:0,caps:style.fontCaps===1?'small':style.fontCaps===2?'all':'normal',
    matrix:multiplyAffine([1,0,0,1,-layer.x,-layer.y],matrix)};
  if(knownWarp.has(data.warp?.style)){text.warpStyle=data.warp.style;text.warpAxis=data.warp.rotate==='vertical'?'vertical':'horizontal';text.warpBend=percent(data.warp.value);text.warpHorizontal=percent(data.warp.perspective);text.warpVertical=percent(data.warp.perspectiveOther);}
  const ctx=document.createElement('canvas').getContext('2d');setTypeFont(ctx,text);const ascent=ctx.measureText('Mg').fontBoundingBoxAscent||size*.8;
  if(text.mode==='paragraph'){
    const box=data.boxBounds;if(Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)){text.x=box[0];text.y=box[1];text.boxWidth=Math.max(1,box[2]-box[0]);text.boxHeight=Math.max(1,box[3]-box[1]);}else issues.add('paragraph bounds unavailable');
  }else{text.x=num(data.pointBase?.[0]);text.y=num(data.pointBase?.[1])-ascent;}
  let offset=0;const runs=[];
  for(const run of data.styleRuns||[]){if(!Number.isFinite(run.length)||run.length<0)continue;const end=Math.min(text.value.length,offset+run.length);unsupportedStyle(run.style||{},style,issues);if(end>offset)runs.push({start:offset,end,style:editorStyle(run.style||{},style)});offset=end;}
  text.runs=normalizeTextRuns(text.value,runs);text.psdUnsupported=[...issues];text.psdOriginal={data:structuredClone(data),signature:signature(text),world:world(text,layer)};return text;
}
function exportStyle(style){
  return{font:{name:style.font||'Inter'},fontSize:style.size,fauxBold:Boolean(style.bold),fauxItalic:Boolean(style.italic),fillColor:psdColor(style.color||'#000000'),tracking:num(style.tracking)*1000/Math.max(.1,num(style.size,48)),baselineShift:num(style.baselineShift),underline:Boolean(style.underline),strikethrough:Boolean(style.strike),autoKerning:style.kerning!=='off',fontCaps:style.caps==='small'?1:style.caps==='all'?2:0,horizontalScale:num(style.glyphScaleX,1),verticalScale:num(style.glyphScaleY,1),autoLeading:!style.leadingPx,leading:style.leadingPx||style.size*(style.leading||1.2)};
}
export function exportPsdType(text,layer){
  if(!text)return null;const currentWorld=world(text,layer),original=text.psdOriginal;
  if(original&&signature(text)===original.signature&&!original.data.textPath){
    const data=structuredClone(original.data),delta=multiplyAffine(currentWorld,inverseAffine(original.world));data.transform=multiplyAffine(delta,data.transform||identity);return data;
  }
  if(text.psdUnsupported?.length||text.path||hasUnsupportedWarp(text))return null;
  const style=exportStyle(text),ctx=document.createElement('canvas').getContext('2d');setTypeFont(ctx,text);const ascent=ctx.measureText('Mg').fontBoundingBoxAscent||text.size*.8;
  const data={text:text.value,transform:text.mode==='paragraph'?currentWorld:multiplyAffine(currentWorld,[1,0,0,1,text.x||0,(text.y||0)+ascent]),style,shapeType:text.mode==='paragraph'?'box':'point',orientation:text.orientation||'horizontal',antiAlias:'smooth',gridding:'none',useFractionalGlyphWidths:true,left:layer.x,top:layer.y,right:layer.x+layer.canvas.width,bottom:layer.y+layer.canvas.height,
    paragraphStyle:{justification:fromAlign[text.align]||text.align||'left',startIndent:num(text.startIndent),endIndent:num(text.endIndent),firstLineIndent:num(text.firstLineIndent),spaceBefore:num(text.spaceBefore),spaceAfter:num(text.spaceAfter),autoLeading:text.leading||1.2,autoHyphenate:false}};
  if(data.shapeType==='box')data.boxBounds=[text.x||0,text.y||0,(text.x||0)+text.boxWidth,(text.y||0)+text.boxHeight];else data.pointBase=[0,0];
  if(knownWarp.has(text.warpStyle)){
    data.warp={style:text.warpStyle,value:percent(text.warpBend),perspective:percent(text.warpHorizontal),perspectiveOther:percent(text.warpVertical),rotate:text.warpAxis==='vertical'?'vertical':'horizontal'};
    const bounds=layoutType({...text,warpStyle:'none'},ctx).bounds,dx=text.mode==='paragraph'?0:text.x||0,dy=text.mode==='paragraph'?0:(text.y||0)+ascent;
    data.left=bounds.x-dx;data.top=bounds.y-dy;data.right=data.left+bounds.w;data.bottom=data.top+bounds.h;
  }
  const runs=normalizeTextRuns(text.value,text.runs),styleRuns=[];let offset=0;
  for(const run of runs){if(run.start>offset)styleRuns.push({length:run.start-offset,style});styleRuns.push({length:run.end-run.start,style:exportStyle({...text,...run.style})});offset=run.end;}
  if(offset<text.value.length)styleRuns.push({length:text.value.length-offset,style});if(styleRuns.length)data.styleRuns=styleRuns;return data;
}
export function canExportPsdType(text){return Boolean(text&&(text.psdOriginal&&signature(text)===text.psdOriginal.signature&&!text.psdOriginal.data.textPath||!text.psdUnsupported?.length&&!text.path&&!hasUnsupportedWarp(text)));}
