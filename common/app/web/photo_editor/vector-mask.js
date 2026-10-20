import {pathContours,tracePath} from './paths.js';
import {featherPlane} from './mask-feather.js';
const coverageCache=new WeakMap();
function canvas(width,height){const result=document.createElement('canvas');result.width=width;result.height=height;return result;}
// Density is applied to coverage before feather: a hidden value of 0 becomes 1-density.
export function applyVectorDensity(value,density){return 1-density*(1-value);}
function pathValid(path){
  if(!path||!Array.isArray(path.nodes)||path.subpaths!=null&&(!Array.isArray(path.subpaths)||path.subpaths.length>10000))return false;
  let count=0;return pathContours(path).every(contour=>contour&&Array.isArray(contour.nodes)&&(count+=contour.nodes.length)<=10000&&contour.nodes.every(node=>node&&Number.isFinite(node.x)&&Number.isFinite(node.y)&&['inX','inY','outX','outY'].every(key=>node[key]==null||Number.isFinite(node[key]))));
}
export function vectorMaskRecord(mask){
  if(!mask||typeof mask!=='object'||Array.isArray(mask)||!pathValid(mask.path))return null;
  const density=Number(mask.density??1),feather=Number(mask.feather||0);
  if(!Number.isFinite(density)||density<0||density>1||!Number.isFinite(feather)||feather<0||feather>1000)return null;
  return {path:structuredClone(mask.path),enabled:mask.enabled!==false,linked:mask.linked!==false,density,feather,inverted:Boolean(mask.inverted)};
}
// Canvas fill alpha is the coverage source. This is not the PhotoCraft analytical vector-mask rasterizer.
export function vectorCoverage(mask,width,height,offsetX=0,offsetY=0,revision=0){
  if(!mask||mask.enabled===false||!mask.path)return null;
  const density=Math.max(0,Math.min(1,Number(mask.density??1))),feather=Math.max(0,Math.min(1000,Number(mask.feather)||0));
  const signature=[width,height,offsetX,offsetY,revision,density,feather,mask.inverted?1:0].join(',');
  const cached=coverageCache.get(mask);if(cached?.signature===signature)return cached.canvas;
  const pad=feather?Math.ceil(feather*3)+2:0,planeWidth=width+pad*2,planeHeight=height+pad*2;
  if(planeWidth>32767||planeHeight>32767||planeWidth*planeHeight>64000000)throw Error('The feathered vector mask exceeds the current 64 million sample limit.');
  const empty=!pathContours(mask.path).some(contour=>contour.nodes?.length),outside=empty?(mask.inverted?0:1):(mask.inverted?1:0);
  const output=canvas(planeWidth,planeHeight),context=output.getContext('2d');
  if(empty){const value=applyVectorDensity(outside,density)*255,image=context.createImageData(planeWidth,planeHeight);for(let i=0;i<image.data.length;i+=4){image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=value;}context.putImageData(image,0,0);}
  else{
    context.fillStyle='#fff';tracePath(context,mask.path,pad-offsetX,pad-offsetY);context.fill(mask.path.fillRule||'nonzero');
    const drawn=context.getImageData(0,0,planeWidth,planeHeight);
    for(let i=0;i<drawn.data.length;i+=4){let value=drawn.data[i+3]/255;if(mask.inverted)value=1-value;value=applyVectorDensity(value,density);drawn.data[i]=drawn.data[i+1]=drawn.data[i+2]=255;drawn.data[i+3]=Math.max(0,Math.min(255,Math.round(value*255)));}
    context.putImageData(drawn,0,0);
  }
  let result=output;
  if(feather){
    const softened=featherPlane(output,feather,applyVectorDensity(outside,density),revision),cropped=canvas(width,height),image=cropped.getContext('2d').createImageData(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=x+pad+softened.padding,sy=y+pad+softened.padding,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,read=(px,py)=>px>=0&&py>=0&&px<softened.width&&py<softened.height?softened.values[py*softened.width+px]:softened.defaultValue,value=read(ix,iy)*(1-fx)*(1-fy)+read(ix+1,iy)*fx*(1-fy)+read(ix,iy+1)*(1-fx)*fy+read(ix+1,iy+1)*fx*fy,i=(y*width+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=Math.max(0,Math.min(255,Math.round(value*255)));}
    cropped.getContext('2d').putImageData(image,0,0);result=cropped;
  }else if(pad){result=canvas(width,height);result.getContext('2d').drawImage(output,-pad,-pad);}
  coverageCache.set(mask,{signature,canvas:result});return result;
}
function knotsOf(path){return pathContours(path).map(contour=>({open:!contour.closed,fillRule:path.fillRule==='evenodd'?'even-odd':'non-zero',operation:path.fillRule==='evenodd'?'exclude':'combine',knots:(contour.nodes||[]).map(node=>({linked:Boolean(node.smooth),points:[node.inX??node.x,node.inY??node.y,node.x,node.y,node.outX??node.x,node.outY??node.y]}))}));}
export function importVectorCoverage(item){
  const mask=item?.vectorMask;if(!mask||mask.fillStartsWithAllPixels||!Array.isArray(mask.paths)||!mask.paths.length)return null;
  if(mask.paths.length>1&&!mask.paths.every(path=>path.operation==='exclude'&&path.fillRule==='even-odd'))return null;
  const contours=[];let count=0;
  for(const path of mask.paths){
    if(path.open||!['combine','exclude',undefined].includes(path.operation)||!Array.isArray(path.knots)||path.knots.length<2)return null;
    const nodes=[];for(const knot of path.knots){const p=knot.points;if(!Array.isArray(p)||p.length!==6||!p.every(Number.isFinite))return null;nodes.push({inX:p[0],inY:p[1],x:p[2],y:p[3],outX:p[4],outY:p[5],smooth:Boolean(knot.linked)});}
    count+=nodes.length;if(count>10000)return null;contours.push({nodes,closed:true});
  }
  const density=item.mask?.vectorMaskDensity==null?1:Number(item.mask.vectorMaskDensity),feather=item.mask?.vectorMaskFeather==null?0:Number(item.mask.vectorMaskFeather);
  if(!Number.isFinite(density)||density<0||density>1||!Number.isFinite(feather)||feather<0||feather>1000)return null;
  const [first,...subpaths]=contours;
  return {path:{...first,subpaths,fillRule:mask.paths[0].fillRule==='even-odd'?'evenodd':'nonzero'},enabled:!mask.disable,linked:!mask.notLink,density,feather,inverted:Boolean(mask.invert)};
}
export function exportVectorCoverage(mask){
  const record=vectorMaskRecord(mask);if(!record)return null;
  return {invert:record.inverted,disable:!record.enabled,notLink:!record.linked,fillStartsWithAllPixels:false,paths:knotsOf(record.path)};
}
