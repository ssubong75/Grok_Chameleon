const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
export function measurePath(path,tolerance=.1){
  const nodes=path?.nodes||[],points=[];let length=0;
  const append=p=>{if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('Path coordinates must be finite.');const last=points.at(-1);if(last){const d=distance(last,p);if(d<1e-9)return;length+=d;}points.push({x:p.x,y:p.y,distance:length});if(points.length>100000)throw Error('This path is too complex for text placement.');};
  function flatten(a,b,c,d,depth=0){
    const chord=distance(a,d),polygon=distance(a,b)+distance(b,c)+distance(c,d);
    // Include a perpendicular-distance check: excess length alone misses shallow bends.
    const cross=p=>chord?Math.abs((d.x-a.x)*(a.y-p.y)-(a.x-p.x)*(d.y-a.y))/chord:distance(a,p);
    if(depth>=16||(polygon-chord<=tolerance&&Math.max(cross(b),cross(c))<=tolerance)){append(d);return;}
    const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),center=midpoint(abc,bcd);
    flatten(a,ab,abc,center,depth+1);flatten(center,bcd,cd,d,depth+1);
  }
  if(nodes.length)append(nodes[0]);
  const count=path.closed?nodes.length:nodes.length-1;
  for(let i=0;i<count;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];flatten(a,{x:a.outX??a.x,y:a.outY??a.y},{x:b.inX??b.x,y:b.inY??b.y},b);}
  return{points,length};
}
export function pointAtDistance(metrics,value){
  const {points,length}=metrics;if(points.length<2||length<=0)return null;
  const target=Math.max(0,Math.min(length,value));let low=1,high=points.length-1;
  while(low<high){const middle=(low+high)>>1;if(points[middle].distance<target)low=middle+1;else high=middle;}
  const a=points[low-1],b=points[low],span=b.distance-a.distance,t=span?(target-a.distance)/span:0;
  return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
}
