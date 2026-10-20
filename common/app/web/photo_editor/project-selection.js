import {alphaSelection,offsetSelection} from './selections.js';
import {pathContours} from './paths.js';
export function packSelection(selection){
  if(!selection)return null;if(selection.kind!=='alpha')return structuredClone(selection);
  const {pixels,runs,...metadata}=selection,canvas=document.createElement('canvas');canvas.width=selection.width;canvas.height=selection.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);for(let i=0;i<pixels.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=255;image.data[i*4+3]=pixels[i];}ctx.putImageData(image,0,0);return{...metadata,png:canvas.toDataURL('image/png')};
}
const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export async function unpackSelection(value,loadImage){
  if(!value)return null;if(!['rect','ellipse','lasso','path','mask','alpha'].includes(value.kind)||!['x','y','w','h'].every(key=>Number.isFinite(value[key]))||value.w<0||value.h<0)throw Error('Invalid project selection.');
  if(value.kind==='alpha'){
    if(!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width>32767||value.height>32767||value.width*value.height>64000000||!Number.isFinite(value.offsetX??0)||!Number.isFinite(value.offsetY??0)||!/^data:image\/png;base64,/.test(value.png||''))throw Error('Invalid project selection mask.');
    const image=await loadImage(value.png);if(image.width!==value.width||image.height!==value.height)throw Error('Project selection dimensions do not match.');const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels=new Uint8ClampedArray(canvas.width*canvas.height);for(let i=0;i<pixels.length;i++)pixels[i]=data[i*4+3];let selection=alphaSelection(pixels,canvas.width,canvas.height);if(!selection)return null;selection=offsetSelection(selection,value.offsetX||0,value.offsetY||0);selection.inverse=Boolean(value.inverse);return selection;
  }
  if(value.kind==='mask'&&(!Array.isArray(value.runs)||value.runs.length>64000000||value.runs.some(run=>!Array.isArray(run)||run.length!==3||!run.every(Number.isFinite)||run[2]<run[1])))throw Error('Invalid project selection spans.');
  if(value.kind==='lasso'&&(!Array.isArray(value.points)||value.points.length>100000||!value.points.every(validPoint)))throw Error('Invalid project lasso.');
  if(value.kind==='path'){
    const path=value.path;if(!path||!Array.isArray(path.nodes)||path.subpaths!=null&&(!Array.isArray(path.subpaths)||path.subpaths.length>10000))throw Error('Invalid project selection path.');let count=0;
    if(!pathContours(path).every(contour=>contour&&Array.isArray(contour.nodes)&&(count+=contour.nodes.length)<=10000&&contour.nodes.every(node=>validPoint(node)&&['inX','inY','outX','outY'].every(key=>node[key]==null||Number.isFinite(node[key])))))throw Error('Invalid project selection path.');
  }
  return structuredClone(value);
}
