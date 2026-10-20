import {shapePath} from './shape-path.js';
import {pathContours,pathBounds,transformPath} from './paths.js';
const colorHex=color=>color&&['r','g','b'].every(key=>Number.isFinite(color[key]))?'#'+['r','g','b'].map(key=>Math.round(Math.max(0,Math.min(255,color[key]))).toString(16).padStart(2,'0')).join(''):null;
export function importPsdShape(item,layer){
  const mask=item.vectorMask,fill=item.vectorFill,stroke=item.vectorStroke,fillEnabled=stroke?.fillEnabled!==false,strokeEnabled=Boolean(stroke?.strokeEnabled);if(!mask||mask.invert||mask.disable||mask.fillStartsWithAllPixels||fillEnabled&&(!fill||fill.type!=='color'))return null;
  const color=fillEnabled?colorHex(fill.color):'#000000';if(!color||fillEnabled&&fill.color.a!=null&&fill.color.a!==255||!Array.isArray(mask.paths)||!mask.paths.length)return null;
  let strokeColor='#000000',strokeWidth=1;
  if(strokeEnabled){
    strokeColor=stroke.content?.type==='color'?colorHex(stroke.content.color):null;
    const width=stroke.lineWidth;if(!strokeColor||stroke.content.color.a!=null&&stroke.content.color.a!==255||stroke.lineAlignment!=='center'||stroke.lineJoinType!=='round'||stroke.lineCapType!=='butt'||stroke.opacity!=null&&stroke.opacity!==1||stroke.blendMode&&stroke.blendMode!=='normal'||stroke.lineDashSet?.some(unit=>unit.value!==0)||stroke.strokeAdjust||!width||!Number.isFinite(width.value))return null;
    if(width.units==='Pixels')strokeWidth=width.value;else if(width.units==='Points')strokeWidth=width.value*(Number(stroke.resolution)||72)/72;else return null;if(strokeWidth<.1||strokeWidth>1000)return null;
  }
  if(!fillEnabled&&!strokeEnabled)return null;
  if(mask.paths.length>1&&!mask.paths.every(path=>path.operation==='exclude'&&path.fillRule==='even-odd'))return null;
  const contours=[];let count=0;
  for(const path of mask.paths){
    if(path.open&&fillEnabled||!['combine','exclude',undefined].includes(path.operation)||!Array.isArray(path.knots)||path.knots.length<2)return null;
    const nodes=[];for(const knot of path.knots){const p=knot.points;if(!Array.isArray(p)||p.length!==6||!p.every(Number.isFinite))return null;nodes.push({inX:p[0]-layer.x,inY:p[1]-layer.y,x:p[2]-layer.x,y:p[3]-layer.y,outX:p[4]-layer.x,outY:p[5]-layer.y,smooth:Boolean(knot.linked)});}
    count+=nodes.length;if(count>10000)return null;contours.push({nodes,closed:!path.open});
  }
  const [first,...subpaths]=contours,path={...first,subpaths,fillRule:mask.paths[0].fillRule==='even-odd'?'evenodd':'nonzero'},bounds=pathBounds(path);if(bounds.w<=0||bounds.h<=0)return null;
  return{type:'path',path,pathBounds:bounds,x:bounds.x,y:bounds.y,w:bounds.w,h:bounds.h,fill:color,fillEnabled,stroke:strokeColor,strokeEnabled,strokeWidth,radius:0,sides:5,inner:.5};
}
export function canExportPsdShape(shape){const color=value=>/^#[\da-f]{6}$/i.test(value||'');return Boolean(shape&&color(shape.fill||'#000000')&&(!shape.strokeEnabled&&shape.type!=='line'||color(shape.stroke||'#000000')&&Number.isFinite(Number(shape.strokeWidth))&&Number(shape.strokeWidth)>=.1&&Number(shape.strokeWidth)<=1000));}
export function exportPsdShape(shape,layer){
  if(!canExportPsdShape(shape))return null;const path=transformPath(shapePath(shape),(x,y)=>({x:x+layer.x,y:y+layer.y})),color=shape.fill||'#000000';
  const result={vectorFill:{type:'color',color:{r:parseInt(color.slice(1,3),16),g:parseInt(color.slice(3,5),16),b:parseInt(color.slice(5,7),16)}},vectorMask:{invert:false,disable:false,notLink:false,fillStartsWithAllPixels:false,paths:pathContours(path).map(contour=>({open:!contour.closed,fillRule:path.fillRule==='evenodd'?'even-odd':'non-zero',operation:path.fillRule==='evenodd'?'exclude':'combine',knots:contour.nodes.map(node=>({linked:Boolean(node.smooth),points:[node.inX??node.x,node.inY??node.y,node.x,node.y,node.outX??node.x,node.outY??node.y]}))}))}};
  if(shape.strokeEnabled||shape.type==='line'||shape.fillEnabled===false){const stroke=shape.stroke||'#000000';result.vectorStroke={strokeEnabled:Boolean(shape.strokeEnabled||shape.type==='line'),fillEnabled:shape.fillEnabled!==false&&shape.type!=='line',lineWidth:{units:'Pixels',value:Number(shape.strokeWidth)||1},lineDashOffset:{units:'Pixels',value:0},lineDashSet:[],lineCapType:'butt',lineJoinType:'round',lineAlignment:'center',miterLimit:10,scaleLock:false,strokeAdjust:false,blendMode:'normal',opacity:1,resolution:72,content:{type:'color',color:{r:parseInt(stroke.slice(1,3),16),g:parseInt(stroke.slice(3,5),16),b:parseInt(stroke.slice(5,7),16)}}};}
  return result;
}
