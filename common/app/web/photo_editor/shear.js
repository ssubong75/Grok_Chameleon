const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function pointsOf(value){
  const points=typeof value==='string'?JSON.parse(value):value;
  if(!Array.isArray(points)||points.length>256||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('Enter up to 256 [position, offset] pairs.');
  return points.map(([t,v])=>[clamp(t,0,1),clamp(v,-1,1)]).sort((a,b)=>a[0]-b[0]).filter((p,i,a)=>!i||Math.abs(p[0]-a[i-1][0])>=1e-6);
}
function curve(points,t){
  if(!points.length)return 0;if(points.length===1||t<=points[0][0])return points[0][1];if(t>=points.at(-1)[0])return points.at(-1)[1];
  const i=points.findIndex((p,i)=>i+1<points.length&&t>=p[0]&&t<=points[i+1][0]),p1=points[i],p2=points[i+1],p0=points[i-1]||p1,p3=points[i+2]||p2,span=Math.max(1e-6,p2[0]-p1[0]),s=(t-p1[0])/span,m1=i>0?(p2[1]-p0[1])/Math.max(1e-6,p2[0]-p0[0])*span:p2[1]-p1[1],m2=i+2<points.length?(p3[1]-p1[1])/Math.max(1e-6,p3[0]-p1[0])*span:p2[1]-p1[1];
  return (2*s**3-3*s*s+1)*p1[1]+(s**3-2*s*s+s)*m1+(-2*s**3+3*s*s)*p2[1]+(s**3-s*s)*m2;
}
export function shear(image,settings={}){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),points=pointsOf(settings.points??[[0,0],[.5,0],[1,0]]),ox=Number(settings.x)||0,oy=Number(settings.y)||0,bw=Number(settings.documentWidth)||width,bh=Number(settings.documentHeight)||height,wrap=settings.edge!=='repeat';
  const read=(x,y,c)=>{x=wrap?((x%bw)+bw)%bw:clamp(x,0,bw-1);y=wrap?((y%bh)+bh)%bh:clamp(y,0,bh-1);x-=ox;y-=oy;return x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+c];};
  for(let y=0;y<height;y++){const offset=curve(points,(y+oy+.5)/bh)*bw/2;for(let x=0;x<width;x++){const sx=x+ox-offset,left=Math.floor(sx),fraction=sx-left,index=(y*width+x)*4,sum=[0,0,0];let alpha=0;for(const [px,weight]of [[left,1-fraction],[left+1,fraction]]){const a=read(px,y+oy,3)/255*weight;alpha+=a;for(let c=0;c<3;c++)sum[c]+=read(px,y+oy,c)*a;}for(let c=0;c<3;c++)data[index+c]=alpha?sum[c]/alpha:0;data[index+3]=alpha*255;}}
  return image;
}
