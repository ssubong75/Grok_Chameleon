// PhotoCraft merge_layers placement: the union of the layer pictures, including pixels outside the canvas.
export function unionBounds(boxes){
  if(!boxes?.length)throw Error('the selected layers are all hidden');
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const box of boxes){x0=Math.min(x0,box.x);y0=Math.min(y0,box.y);x1=Math.max(x1,box.x+box.w);y1=Math.max(y1,box.y+box.h);}
  if(!Number.isFinite(x0)||x1<=x0||y1<=y0)throw Error('the selected layers have no content to merge');
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
