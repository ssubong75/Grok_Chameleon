const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function cubic(t){const near=x=>1.25*x**3-2.25*x*x+1,far=x=>-.75*(x**3-5*x*x+8*x-4);return[far(1+t),near(t),near(1-t),far(2-t)];}
export function warpTriangles(image,vertices,triangles,settings={}){
  if(settings.expand){
    const lim=1<<20;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const vertex of vertices){x0=Math.min(x0,vertex.destination[0]);y0=Math.min(y0,vertex.destination[1]);x1=Math.max(x1,vertex.destination[0]);y1=Math.max(y1,vertex.destination[1]);}
    const left=Math.floor(Math.max(x0,-lim))-1,top=Math.floor(Math.max(y0,-lim))-1,right=Math.ceil(Math.min(x1,lim))+1,bottom=Math.ceil(Math.min(y1,lim))+1,width=right-left,height=bottom-top;
    if(!Number.isFinite(left)||width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The warped layer exceeds 32,767 pixels per side and 64 million pixels.');
    const shifted=vertices.map(vertex=>({...vertex,destination:[vertex.destination[0]-left,vertex.destination[1]-top]}));
    const output=warpTriangles({data:new Uint8ClampedArray(width*height*4),width,height},shifted,triangles,{interpolation:settings.interpolation});
    output.x=left;output.y=top;return output;
  }
  const {width,height,data}=image,source=new Uint8ClampedArray(data),ox=Number(settings.x)||0,oy=Number(settings.y)||0,interpolation=settings.interpolation||'bicubic',sample=(u,v,mode,out)=>{out.fill(0);u-=ox;v-=oy;const add=(x,y,weight)=>{if(x<0||y<0||x>=width||y>=height||weight===0)return;const i=(y*width+x)*4,a=source[i+3]/255;for(let c=0;c<3;c++)out[c]+=source[i+c]/255*a*weight;out[3]+=a*weight;};if(mode==='nearest'){add(Math.floor(u+.5),Math.floor(v+.5),1);return;}if(mode==='bicubic'){if(Math.abs(u-Math.round(u))<1e-7)u=Math.round(u);if(Math.abs(v-Math.round(v))<1e-7)v=Math.round(v);const x=Math.floor(u),y=Math.floor(v),wx=cubic(u-x),wy=cubic(v-y);for(let j=0;j<4;j++)for(let i=0;i<4;i++)add(x+i-1,y+j-1,wx[i]*wy[j]);}else{const x=Math.floor(u),y=Math.floor(v),fx=u-x,fy=v-y;add(x,y,(1-fx)*(1-fy));add(x+1,y,fx*(1-fy));add(x,y+1,(1-fx)*fy);add(x+1,y+1,fx*fy);}};
  data.fill(0);if(vertices.some(v=>v.destination.some(n=>!Number.isFinite(n))))return image;
  const acc=new Float64Array(4),one=new Float64Array(4);
  for(const tri of triangles){const [{destination:p0,source:s0},{destination:p1,source:s1},{destination:p2,source:s2}]=tri.map(i=>vertices[i]),det=(p1[0]-p0[0])*(p2[1]-p0[1])-(p2[0]-p0[0])*(p1[1]-p0[1]);if(Math.abs(det)<1e-12)continue;
    const d1=[s1[0]-s0[0],s1[1]-s0[1]],d2=[s2[0]-s0[0],s2[1]-s0[1]],l1x=(p2[1]-p0[1])/det,l1y=(p0[0]-p2[0])/det,l2x=(p0[1]-p1[1])/det,l2y=(p1[0]-p0[0])/det,cap=j=>{const length=Math.hypot(...j);return length>8?j.map(v=>v*8/length):j;},jx=cap([l1x*d1[0]+l2x*d2[0],l1x*d1[1]+l2x*d2[1]]),jy=cap([l1y*d1[0]+l2y*d2[0],l1y*d1[1]+l2y*d2[1]]),nx=interpolation==='nearest'?1:clamp(Math.round(Math.hypot(...jx)),1,8),ny=interpolation==='nearest'?1:clamp(Math.round(Math.hypot(...jy)),1,8),x0=Math.max(0,Math.floor(Math.min(p0[0],p1[0],p2[0])-.5-ox)),x1=Math.min(width,Math.ceil(Math.max(p0[0],p1[0],p2[0])+.5-ox)),y0=Math.max(0,Math.floor(Math.min(p0[1],p1[1],p2[1])-.5-oy)),y1=Math.min(height,Math.ceil(Math.max(p0[1],p1[1],p2[1])+.5-oy));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const px=ox+x+.5,py=oy+y+.5,l1=((px-p0[0])*(p2[1]-p0[1])-(p2[0]-p0[0])*(py-p0[1]))/det,l2=((p1[0]-p0[0])*(py-p0[1])-(px-p0[0])*(p1[1]-p0[1]))/det,l0=1-l1-l2;if(l0< -1e-9||l1< -1e-9||l2< -1e-9)continue;const u=l0*s0[0]+l1*s1[0]+l2*s2[0],v=l0*s0[1]+l1*s1[1]+l2*s2[1];if(nx*ny===1)sample(u-.5,v-.5,interpolation,acc);else{acc.fill(0);for(let sy=0;sy<ny;sy++)for(let sx=0;sx<nx;sx++){const s=(sx+.5)/nx-.5,t=(sy+.5)/ny-.5;sample(u+s*jx[0]+t*jy[0]-.5,v+s*jx[1]+t*jy[1]-.5,'bilinear',one);for(let c=0;c<4;c++)acc[c]+=one[c];}for(let c=0;c<4;c++)acc[c]/=nx*ny;}const i=(y*width+x)*4,a=clamp(acc[3],0,1);for(let c=0;c<3;c++)data[i+c]=a>1e-6?clamp(acc[c]/a,0,1)*255:0;data[i+3]=a>1e-6?a*255:0;}
  }
  return image;
}
