// Affine transforms in document coordinates, without a compiled image runtime.
export function affinePoint(matrix,x,y){return{x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]};}
export function inverseAffine(matrix){const [a,b,c,d,e,f]=matrix,det=a*d-b*c;if(!matrix.every(Number.isFinite)||Math.abs(det)<1e-12)throw Error('The text transform cannot be inverted.');return[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];}
export function multiplyAffine(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function layerMatrix(layer,{x=layer.x,y=layer.y,scaleX=1,scaleY=1,angle=0,skewX=0,skewY=0}={}){
  const radians=angle*Math.PI/180,snap=v=>Math.abs(v)<1e-12?0:Math.abs(v-1)<1e-12?1:Math.abs(v+1)<1e-12?-1:v,c=snap(Math.cos(radians)),s=snap(Math.sin(radians));
  const a=c*scaleX-s*Math.tan(skewY*Math.PI/180),b=s*scaleX+c*Math.tan(skewY*Math.PI/180);
  const cc=c*Math.tan(skewX*Math.PI/180)-s*scaleY,d=s*Math.tan(skewX*Math.PI/180)+c*scaleY;
  const cx=layer.canvas.width/2,cy=layer.canvas.height/2;
  return[a,b,cc,d,x+cx-a*cx-cc*cy,y+cy-b*cx-d*cy];
}
export function transformedBounds(matrix,width,height){
  const points=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>affinePoint(matrix,x,y));
  const left=Math.floor(Math.min(...points.map(p=>p.x))),top=Math.floor(Math.min(...points.map(p=>p.y)));
  return{x:left,y:top,width:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.x)))-left),height:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.y)))-top)};
}
export function translateSmartOperations(operations,dx,dy){return(operations||[]).map(operation=>{
  if(operation.type==='filter'&&operation.amount&&typeof operation.amount==='object'){const amount=structuredClone(operation.amount);if(Number.isFinite(amount.x))amount.x+=dx;if(Number.isFinite(amount.y))amount.y+=dy;if(amount.depthImage){if(Number.isFinite(amount.depthImage.x))amount.depthImage.x+=dx;if(Number.isFinite(amount.depthImage.y))amount.depthImage.y+=dy;}return{...operation,amount};}
  if(operation.type==='resizePixels'){const settings={...operation.settings};settings.offsetX=(settings.offsetX||0)+dx*(1-settings.scaleX);settings.offsetY=(settings.offsetY||0)+dy*(1-settings.scaleY);return{...operation,settings};}
  if(operation.type==='perspective'||operation.type==='warpPlace')return{...operation,quad:operation.quad.map(point=>({x:point.x+dx,y:point.y+dy}))};
  if(operation.type==='transform'){const settings={...operation.settings};if(Number.isFinite(settings.x))settings.x+=dx;if(Number.isFinite(settings.y))settings.y+=dy;return{...operation,settings};}return operation;
});}

export function translateSmartRecord(layer,dx,dy,moveFilterMask=false){
  const quad=value=>Array.isArray(value)&&value.length===8?value.map((n,i)=>n+(i%2?dy:dx)):value;
  if(layer.smartPsd)layer.smartPsd.transform=quad(layer.smartPsd.transform);
  if(layer.smartImportQuad)layer.smartImportQuad=quad(layer.smartImportQuad);
  const rect=value=>{if(!value)return;for(const key of ['left','right'])if(Number.isFinite(value[key]))value[key]+=dx;for(const key of ['top','bottom'])if(Number.isFinite(value[key]))value[key]+=dy;};
  if(layer.smartFeid){rect(layer.smartFeid);rect(layer.smartFeid.extra);}
  if(moveFilterMask&&layer.smartFilterMask){layer.smartFilterMask.x+=dx;layer.smartFilterMask.y+=dy;}
}
