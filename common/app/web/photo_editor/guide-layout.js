import {pathBounds} from './paths.js';
import {shapePath} from './shape-path.js';
const COMMAND='view.newGuideLayout',MAX_COUNT=1000,MAX_EDGES=16000;
const bad=message=>Error(message);
function number(params,key,fallback){if(params?.[key]==null||params[key]==='')return fallback;const value=Number(params[key]);if(!Number.isFinite(value)||value<0)throw bad(key+' must be a finite non-negative number');return value;}
function count(params,key){if(params?.[key]==null)return 0;const value=Number(params[key]);if(!Number.isInteger(value)||value<0)throw bad(key+' must be a whole number');if(value>MAX_COUNT)throw bad(key+' must be '+MAX_COUNT+' or fewer (got '+value+')');return value;}
function flag(params,key){if(params?.[key]==null)return false;if(typeof params[key]!=='boolean')throw bad(key+' must be a boolean');return params[key];}
function pushUnique(out,value){if(!Number.isFinite(value))throw bad('guide coordinates exceed the supported range');if(!out.some(item=>Math.abs(item-value)<0.01))out.push(value);}
function axis(start,end,n,fixed,gap,center,out){if(!n)return;const available=end-start,width=fixed>0?fixed:(available-(n-1)*gap)/n,total=n*width+(n-1)*gap;if(width<=0||!Number.isFinite(total)||total>available+0.001)throw bad('count, size and gutter must fit inside the target margins');const origin=center&&fixed>0?start+(available-total)/2:start;for(let i=0;i<n;i++){const at=origin+i*(width+gap);pushUnique(out,at);pushUnique(out,at+width);}}
function marginsOf(params){const margin=params?.margin;if(Array.isArray(margin)){if(margin.length!==4)throw bad('margin must contain top, left, bottom and right');return margin.map(value=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw bad('margins must be finite non-negative numbers');return n;});}const n=number(params,'margin',0);return [n,n,n,n];}
export const guideLayoutDefaults={columns:8,gutter:20,rows:0,rowGutter:0,margin:0,centerColumns:false,clearExisting:false,target:'document'};
export function guideLayout(doc,params={}){
  if(!doc)throw bad('Open a document first.');
  const columns=count(params,'columns'),rows=count(params,'rows'),width=number(params,'width',0),height=number(params,'height',0),gutter=number(params,'gutter',0),rowGutter=number(params,'rowGutter',gutter),center=flag(params,'centerColumns'),clear=flag(params,'clearExisting'),[top,left,bottom,right]=marginsOf(params);
  const target=params.target==null?'document':params.target;
  if(typeof target!=='string')throw bad('target must be a string');
  let bounds;
  if(target==='document')bounds=[{x0:0,y0:0,x1:doc.width,y1:doc.height}];
  else if(target==='selectedArtboards'){const selected=new Set(doc.selectedIds||[]),boards=[];for(const layer of doc.artboards||[])if(selected.has(layer.id))boards.push(layer);if(!boards.length)throw bad('select an artboard or a layer inside one');bounds=boards.map(board=>({x0:board.x,y0:board.y,x1:board.x+board.w,y1:board.y+board.h}));}
  else throw bad('target must be document or selectedArtboards');
  if((columns+rows+4)*2*bounds.length>MAX_EDGES)throw bad('the selected targets would create too many guide lines');
  const added={vertical:[],horizontal:[]};
  for(const rect of bounds){const x0=rect.x0+left,y0=rect.y0+top,x1=rect.x1-right,y1=rect.y1-bottom;if(x0>=x1||y0>=y1)throw bad('margins must leave space inside the target');if([top,left,bottom,right].some(value=>value!==0)){pushUnique(added.vertical,x0);pushUnique(added.vertical,x1);pushUnique(added.horizontal,y0);pushUnique(added.horizontal,y1);}axis(x0,x1,columns,width,gutter,center,added.vertical);axis(y0,y1,rows,height,rowGutter,center,added.horizontal);}
  if(!added.vertical.length&&!added.horizontal.length)throw bad('give "columns", "rows" or a "margin"');
  let vertical=(doc.guides||[]).filter(guide=>guide.axis==='vertical').map(guide=>guide.position),horizontal=(doc.guides||[]).filter(guide=>guide.axis==='horizontal').map(guide=>guide.position);
  if(clear){if(target==='selectedArtboards'){vertical=vertical.filter(value=>!bounds.some(rect=>value>=rect.x0&&value<=rect.x1));horizontal=horizontal.filter(value=>!bounds.some(rect=>value>=rect.y0&&value<=rect.y1));}else{vertical=[];horizontal=[];}}
  for(const value of added.vertical)pushUnique(vertical,value);
  for(const value of added.horizontal)pushUnique(horizontal,value);
  const reuse=(axis,position)=>(doc.guides||[]).find(guide=>guide.axis===axis&&Math.abs(guide.position-position)<0.01)||{axis,position};
  const guides=[...vertical.map(position=>reuse('vertical',position)),...horizontal.map(position=>reuse('horizontal',position))];
  return {vertical:added.vertical,horizontal:added.horizontal,guides};
}
export function shapeGuideBounds(layer){
  if(!layer?.shape)throw Error('the layer is not a shape layer');
  let path;try{path=shapePath(layer.shape);}catch{throw Error('the shape has no path');}
  const nodes=[path,...(path.subpaths||[])].some(part=>part?.nodes?.length);
  if(!nodes)throw Error('the shape has no path');
  const box=pathBounds(path),x0=(layer.x||0)+box.x,y0=(layer.y||0)+box.y;
  return {x0,y0,x1:x0+box.w,y1:y0+box.h};
}
export function guidesFromShape(guides,bounds){
  const next=(guides||[]).map(guide=>({...guide}));
  const add=(axis,position)=>{if(!next.some(guide=>guide.axis===axis&&Math.abs(guide.position-position)<0.01))next.push({axis,position});};
  const mx=(bounds.x0+bounds.x1)/2,my=(bounds.y0+bounds.y1)/2;
  for(const x of [bounds.x0,mx,bounds.x1])add('vertical',x);
  for(const y of [bounds.y0,my,bounds.y1])add('horizontal',y);
  return next;
}
