import {rectanglePath,ellipsePath,pathBounds,transformPath} from './paths.js';
import {affinePoint} from './transforms.js';
export function shapePath(shape){
  const {x,y,w,h}=shape;if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)throw Error('Enter valid positive shape dimensions.');
  if(shape.type==='path'){
    const path=structuredClone(shape.path),b=shape.pathBounds||pathBounds(path);if(b.w<=0||b.h<=0)throw Error('The shape path has no area.');return transformPath(path,(px,py)=>({x:x+(px-b.x)*w/b.w,y:y+(py-b.y)*h/b.h}));
  }
  if(shape.type==='ellipse')return ellipsePath(x,y,w,h);
  if(shape.type==='line')return{closed:false,nodes:[{x,y},{x:x+w,y:y+h}]};
  if(shape.type==='polygon'||shape.type==='star'){
    const sides=Math.max(3,Math.min(100,Math.round(shape.sides)||5)),count=shape.type==='star'?2*sides:sides,inner=Math.max(.05,Math.min(1,Number(shape.inner)||.5));
    return{closed:true,nodes:Array.from({length:count},(_,index)=>{const angle=-Math.PI/2+index/count*Math.PI*2,factor=shape.type==='star'&&index%2?inner:1;return{x:x+w/2+Math.cos(angle)*w/2*factor,y:y+h/2+Math.sin(angle)*h/2*factor};})};
  }
  const r=Math.max(0,Math.min(w/2,h/2,Number(shape.radius)||0));if(!r)return rectanglePath(x,y,w,h);const k=.5522847498307936*r;
  return{closed:true,nodes:[{x:x+r,y,inX:x+r-k,inY:y},{x:x+w-r,y,outX:x+w-r+k,outY:y},{x:x+w,y:y+r,inX:x+w,inY:y+r-k},{x:x+w,y:y+h-r,outX:x+w,outY:y+h-r+k},{x:x+w-r,y:y+h,inX:x+w-r+k,inY:y+h},{x:x+r,y:y+h,outX:x+r-k,outY:y+h},{x,y:y+h-r,inX:x,inY:y+h-r+k},{x,y:y+r,outX:x,outY:y+r-k}]};
}
export function transformedShape(shape,matrix,bounds){
  if(!shape)return null;
  const sx=Math.hypot(matrix[0],matrix[1]),sy=Math.hypot(matrix[2],matrix[3]),dot=matrix[0]*matrix[2]+matrix[1]*matrix[3],stroke=shape.strokeEnabled||shape.type==='line';
  if(stroke&&(Math.abs(sx-sy)>1e-6*Math.max(1,sx,sy)||Math.abs(dot)>1e-6*Math.max(1,sx*sy)))return null;
  const path=transformPath(shapePath(shape),(x,y)=>{const p=affinePoint(matrix,x,y);return{x:p.x-bounds.x,y:p.y-bounds.y};}),b=pathBounds(path);
  if(b.w<=0||b.h<=0)return null;
  return{...shape,type:'path',path,pathBounds:b,x:b.x,y:b.y,w:b.w,h:b.h,strokeWidth:stroke?(Number(shape.strokeWidth)||1)*sx:shape.strokeWidth,fillEnabled:shape.type==='line'?false:shape.fillEnabled,strokeEnabled:Boolean(stroke)};
}
