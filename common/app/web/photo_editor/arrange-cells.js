const LAYOUTS=new Set(['tileAllVertically','tileAllHorizontally','twoUpVertical','twoUpHorizontal','threeUpVertical','threeUpHorizontal','threeUpStacked','fourUp','sixUp','tile']);
function grid(rect,cols,rows,count){const w=rect.w/cols,h=rect.h/rows,n=Math.min(count,cols*rows),out=[];for(let i=0;i<n;i++)out.push({x:rect.x+(i%cols)*w,y:rect.y+Math.floor(i/cols)*h,w,h});return out;}
export function arrangeCells(layout,rect,n){
  if(n<2||!LAYOUTS.has(layout))return null;
  if(layout==='tileAllVertically')return grid(rect,n,1,n);
  if(layout==='tileAllHorizontally')return grid(rect,1,n,n);
  if(layout==='twoUpVertical'){const mid=rect.x+rect.w/2;return [{x:rect.x,y:rect.y,w:mid-rect.x,h:rect.h},{x:mid,y:rect.y,w:rect.x+rect.w-mid,h:rect.h}];}
  if(layout==='twoUpHorizontal'){const mid=rect.y+rect.h/2;return [{x:rect.x,y:rect.y,w:rect.w,h:mid-rect.y},{x:rect.x,y:mid,w:rect.w,h:rect.y+rect.h-mid}];}
  if(layout==='threeUpVertical')return grid(rect,3,1,3);
  if(layout==='threeUpHorizontal')return grid(rect,1,3,3);
  if(layout==='threeUpStacked'){const mid=rect.x+rect.w/2,right={x:mid,y:rect.y,w:rect.x+rect.w-mid,h:rect.h},row=rect.y+rect.h/2;return [{x:rect.x,y:rect.y,w:mid-rect.x,h:rect.h},{x:right.x,y:rect.y,w:right.w,h:row-rect.y},{x:right.x,y:row,w:right.w,h:rect.y+rect.h-row}];}
  if(layout==='fourUp')return grid(rect,2,2,4);
  if(layout==='sixUp')return grid(rect,3,2,6);
  const cols=Math.ceil(Math.sqrt(n));
  return grid(rect,cols,Math.ceil(n/cols),n);
}
export function arrangeDocuments(layout,rect,n,active,start=0){
  const cells=arrangeCells(layout,rect,n);
  if(!cells)return null;
  let from=Math.min(start,Math.max(0,n-cells.length));
  if(active<from)from=active;else from=Math.max(from,Math.max(0,active+1-cells.length));
  const out=[];
  for(let i=0;i<cells.length&&from+i<n;i++)out.push({index:from+i,cell:cells[i]});
  return {start:from,cells:out};
}
export function cascadePositions(count,cascade){return Array.from({length:count},(_,index)=>cascade?[24+index*28,24+index*28]:[24,24]);}
export function floatTarget(count,active,payload){
  if(!count)throw Error('no document');
  let index=active|0;
  if(payload?.document!=null){const value=payload.document;if(typeof value!=='number'||!Number.isInteger(value))throw Error('document must be a document index');if(value<0||value>=count)throw Error('no document '+value);index=value;}
  let position=null;
  if(payload?.position!=null){const point=payload.position;if(!Array.isArray(point)||point.length!==2||!point.every(value=>Number.isFinite(Number(value))))throw Error('position must be [x, y] in points');position=[Number(point[0]),Number(point[1])];}
  return {index,position};
}
export function matchView(source,key){
  const zoom=key==='matchZoom'||key==='matchAll',location=key==='matchLocation'||key==='matchAll',rotation=key==='matchRotation'||key==='matchAll';
  if(!zoom&&!location&&!rotation)throw Error('unknown arrangement '+key);
  return {zoom:zoom?source.zoom:null,center:location?source.center.slice():null,rotation:rotation?source.rotation:null};
}
