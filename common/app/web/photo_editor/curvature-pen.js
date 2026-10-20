const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const unit=(a,b)=>{const l=dist(a,b);return l>1e-9?[(b[0]-a[0])/l,(b[1]-a[1])/l]:null;};
export function curvatureKnots(anchors,corners=[],closed=false){
  const n=anchors.length,knots=anchors.map(p=>({x:p[0],y:p[1],inX:p[0],inY:p[1],outX:p[0],outY:p[1],smooth:false}));
  const corner=i=>Boolean(corners[i]),inner=i=>closed||(i>0&&i+1<n);
  anchors.forEach((p,i)=>{if(n<3||corner(i)||!inner(i))return;const prev=anchors[(i+n-1)%n],next=anchors[(i+1)%n],d=unit(prev,next)||unit(p,next);if(!d)return;const li=dist(prev,p)/3,lo=dist(p,next)/3;knots[i]={x:p[0],y:p[1],inX:p[0]-d[0]*li,inY:p[1]-d[1]*li,outX:p[0]+d[0]*lo,outY:p[1]+d[1]*lo,smooth:true};});
  if(!closed&&n>=3){for(const [end,nb,takeIn] of [[0,1,true],[n-1,n-2,false]]){if(corner(end))continue;const p=anchors[end],aim=takeIn?[knots[nb].inX,knots[nb].inY]:[knots[nb].outX,knots[nb].outY],d=unit(p,aim);if(!d)continue;const l=dist(p,anchors[nb])/3,h=[p[0]+d[0]*l,p[1]+d[1]*l];if(takeIn){knots[end].outX=h[0];knots[end].outY=h[1];}else{knots[end].inX=h[0];knots[end].inY=h[1];}knots[end].smooth=true;}}
  return knots;
}
export function curvatureHit(anchors,p,zoom){const tol=6/Math.max(.01,zoom);let best=null;anchors.forEach((a,i)=>{const d=Math.hypot(a[0]-p.x,a[1]-p.y);if(d<tol&&(!best||d<best.d))best={i,d};});return best?.i??null;}
