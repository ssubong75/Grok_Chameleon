// Affine transforms in document coordinates, without a compiled image runtime.
export function affinePoint(matrix,x,y){return{x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]};}
export function multiplyAffine(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function layerMatrix(layer,{x=layer.x,y=layer.y,scaleX=1,scaleY=1,angle=0,skewX=0,skewY=0}={}){
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
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
  if(operation.type==='perspective')return{...operation,quad:operation.quad.map(point=>({x:point.x+dx,y:point.y+dy}))};
  if(operation.type==='transform'){const settings={...operation.settings};if(Number.isFinite(settings.x))settings.x+=dx;if(Number.isFinite(settings.y))settings.y+=dy;return{...operation,settings};}return operation;
});}
