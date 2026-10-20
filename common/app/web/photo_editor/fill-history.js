import {warpPlaceBounds} from './warp-place.js';
import {layerMatrix,transformedBounds,affinePoint} from './transforms.js';
import {quadMapping} from './perspective.js';
// Rebase size-dependent transform pivots onto a regenerated procedural source.
export function rebaseFillHistory(operations,oldFrame,newFrame){
  let old={...oldFrame},next={...newFrame};
  const resized=(frame,s)=>{const x=Math.floor(frame.x*s.scaleX)+(s.offsetX||0),y=Math.floor(frame.y*s.scaleY)+(s.offsetY||0);return{x,y,width:Math.max(1,Math.ceil((frame.x+frame.width)*s.scaleX)-Math.floor(frame.x*s.scaleX)),height:Math.max(1,Math.ceil((frame.y+frame.height)*s.scaleY)-Math.floor(frame.y*s.scaleY))};};
  const layer=frame=>({...frame,canvas:{width:frame.width,height:frame.height}});
  const output=[];
  for(const original of operations||[]){const operation=structuredClone(original);if(operation.enabled===false){output.push(operation);continue;}
    if(operation.type==='transform'){
      const matrix=layerMatrix(layer(old),operation.settings),absolute=[...matrix];absolute[4]-=matrix[0]*old.x+matrix[2]*old.y;absolute[5]-=matrix[1]*old.x+matrix[3]*old.y;
      const origin=affinePoint(absolute,next.x,next.y),cx=next.width/2,cy=next.height/2;
      operation.settings={...operation.settings,x:origin.x-cx+matrix[0]*cx+matrix[2]*cy,y:origin.y-cy+matrix[1]*cx+matrix[3]*cy};
      old=transformedBounds(matrix,old.width,old.height);next=transformedBounds(layerMatrix(layer(next),operation.settings),next.width,next.height);
    }else if(operation.type==='perspective'){
      const corners=f=>[{x:f.x,y:f.y},{x:f.x+f.width,y:f.y},{x:f.x+f.width,y:f.y+f.height},{x:f.x,y:f.y+f.height}],map=quadMapping(corners(old),operation.quad),apply=p=>{const d=map[6]*p.x+map[7]*p.y+1;if(!Number.isFinite(d)||Math.abs(d)<1e-10)throw Error('The regenerated fill crosses the perspective horizon.');return{x:(map[0]*p.x+map[1]*p.y+map[2])/d,y:(map[3]*p.x+map[4]*p.y+map[5])/d};};
      const mapped=corners(next).map(apply),bounds=q=>{const x=Math.floor(Math.min(...q.map(p=>p.x))),y=Math.floor(Math.min(...q.map(p=>p.y)));return{x,y,width:Math.ceil(Math.max(...q.map(p=>p.x)))-x,height:Math.ceil(Math.max(...q.map(p=>p.y)))-y};};old=bounds(operation.quad);operation.quad=mapped;next=bounds(mapped);
    }else if(operation.type==='warpPlace'){
      if(operation.mesh&&!operation.domain)operation.domain={x:0,y:0,width:old.width,height:old.height};
      old=warpPlaceBounds(old.width,old.height,operation);next=warpPlaceBounds(next.width,next.height,operation);
    }else if(operation.type==='resizePixels'){old=resized(old,operation.settings);next=resized(next,operation.settings);}
    else if(operation.type!=='filter')throw Error('Unsupported fill history operation: '+operation.type);
    for(const frame of [old,next])if(!Object.values(frame).every(Number.isFinite)||frame.width<1||frame.height<1||frame.width>32767||frame.height>32767||frame.width*frame.height>64000000)throw Error('The regenerated fill exceeds the layer size limit.');
    output.push(operation);
  }
  return output;
}
