import {VanishingPlane,VanishingScene,Homography} from './vanishing-geometry.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback)=>{const value=Number(v??fallback);if(!Number.isFinite(value))throw Error('Vanishing Point settings must be finite.');return value;};
const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v));
export function vanishingScene(settings,width,height){
  const planes=typeof settings.planes==='string'?JSON.parse(settings.planes):settings.planes;if(!Array.isArray(planes)||!planes.length||planes.length>128)throw Error('Specify between 1 and 128 planes.');const center=[width/2,height/2],drawn=(entry,i)=>{const plane=new VanishingPlane(entry.corners);if(plane.check(center)==='invalid')throw Error('Plane '+i+' must be a convex quadrilateral.');return plane;},scene=new VanishingScene(drawn(planes[0],0),center,finite(settings.focalLength,0),Math.max(width,height));
  for(let i=1;i<planes.length;i++){const entry=planes[i];if(entry.corners)scene.planes.push(drawn(entry,i));else{if(!Number.isInteger(entry.from)||entry.from<0||entry.from>=scene.planes.length)throw Error('An adjacent plane must reference an earlier plane.');if(scene.tearOff(entry.from,entry.edge||'top',finite(entry.angle,90),finite(entry.depth,1))===null)throw Error('An adjacent plane lies behind the camera.');}}
  return scene;
}
function over(data,index,color){const sa=color[3],da=data[index+3]/255,oa=sa+da*(1-sa);for(let c=0;c<3;c++)data[index+c]=oa>0?(color[c]*sa+data[index+c]/255*da*(1-sa))/oa*255:0;data[index+3]=oa*255;}
function cubic(t){const near=x=>1.25*x**3-2.25*x*x+1,far=x=>-.75*(x**3-5*x*x+8*x-4);return[far(1+t),near(t),near(1-t),far(2-t)];}
function keysWeight(x,a){x=Math.abs(x);if(x<1)return (a+2)*x*x*x-(a+3)*x*x+1;if(x<2)return a*(x*x*x-5*x*x+8*x-4);return 0;}
function samplePosition(o,scale,edge){let u=(o+.5)/scale-.5;if(edge)u=Math.max(edge[0],Math.min(edge[1],u));const j=Math.floor(u);return j+Math.round((u-j)*128)/128;}
function coverSpan(o,scale){const a=Math.floor(o/scale+1e-9);return [a,Math.max(a+1,Math.floor((o+1)/scale+1e-9))];}
function axisWeights(o,scale,stretch,edge){
  if(scale<0.25){const inner=4*scale,innerEdge=edge?[Math.ceil(edge[0]*inner-1e-9),Math.ceil((edge[1]+1)*inner-1e-9)-1]:null,clamp=k=>innerEdge?Math.max(innerEdge[0],Math.min(innerEdge[1],k)):k,[k0,kw]=axisWeights(o,.25,stretch,innerEdge),boxes=kw.map((v,i)=>[...coverSpan(clamp(k0+i),inner),v]),lo=Math.min(...boxes.map(b=>b[0])),hi=Math.max(...boxes.map(b=>b[1])),w=Array(Math.max(0,hi-lo)).fill(0);for(const [a,b,v] of boxes)for(let i=a;i<b;i++)w[i-lo]+=v/(b-a);return [lo,w];}
  const u=samplePosition(o,scale,edge),lo=Math.floor(u-2*stretch),hi=Math.ceil(u+2*stretch),raw=[];for(let i=lo;i<=hi;i++)raw.push(keysWeight((u-i)/stretch,-.75));const sum=raw.reduce((s,v)=>s+v,0)||1;return [lo,raw.map(v=>v/sum)];
}
function axisTaps(count,scale,content){
  const edge=[content[0],content[1]],stretch=1/Math.max(.25,Math.min(1,scale)),clamp=i=>Math.max(edge[0],Math.min(edge[1],i)),out=[];
  for(let o=0;o<count;o++){
    const [lo,w]=scale===1?[Math.floor((o+.5)/scale-.5+.5),[1]]:axisWeights(o,scale,stretch,edge),hi=lo+w.length-1,start=clamp(lo),folded=Array(Math.max(1,clamp(hi)-start+1)).fill(0);
    for(let i=0;i<w.length;i++){const slot=clamp(lo+i)-start;if(folded[slot]!=null)folded[slot]+=w[i];}
    const a=Math.max(start,content[0]),b=Math.min(start+folded.length-1,content[1]);
    if(a>b){out.push({start:content[0],weights:[],outside:folded.reduce((s,v)=>s+v,0)});continue;}
    const i0=a-start,i1=b-start+1;out.push({start:a,weights:folded.slice(i0,i1),outside:folded.slice(0,i0).reduce((s,v)=>s+v,0)+folded.slice(i1).reduce((s,v)=>s+v,0)});
  }
  return out;
}
export function reduceRgba(data,width,height,scale){
  const pass=(pixels,w,h,sx,sy)=>{const dw=sx===1?w:Math.ceil(w*sx),dh=sy===1?h:Math.ceil(h*sy),xt=axisTaps(dw,sx,[0,w-1]),yt=axisTaps(dh,sy,[0,h-1]),out=new Uint8ClampedArray(dw*dh*4);
    for(let y=0;y<dh;y++){const row=new Float64Array(dw*4),tap=yt[y];
      for(let x=0;x<dw;x++){const acc=[0,0,0,0],src=xt[x];for(let k=0;k<src.weights.length;k++){const xx=src.start+k;if(xx<0||xx>=w)continue;for(let j=0;j<tap.weights.length;j++){const yy=tap.start+j;if(yy<0||yy>=h)continue;const p=(yy*w+xx)*4,weight=src.weights[k]*tap.weights[j];for(let c=0;c<4;c++)acc[c]+=pixels[p+c]*weight;}}for(let c=0;c<4;c++)row[x*4+c]=acc[c];}
      for(let x=0;x<dw;x++){const i=(y*dw+x)*4;for(let c=0;c<4;c++)out[i+c]=Math.max(0,Math.min(255,Math.round(row[x*4+c])));}
    }
    return {data:out,width:dw,height:dh};
  };
  const wide=pass(data,width,height,scale,1);return pass(wide.data,wide.width,wide.height,1,scale);
}
function paste(scene,item,image){
  const plane=Number(item.plane??0),frame=scene.frame(plane),src=item.source;if(!frame||!src||!Number.isInteger(src.width)||!Number.isInteger(src.height)||src.width<1||src.height<1||src.width*src.height>64000000||src.data?.length!==src.width*src.height*4)throw Error('Choose a valid plane and paste source.');const at=item.at??[.25,.25];if(!point(at))throw Error('Paste position requires [u, v].');const fraction=clamp(finite(item.width,.5),.01,10),su=fraction/src.width,sv=fraction*frame.width/frame.height/src.width,full=frame.h.multiply(new Homography([su,0,at[0],0,sv,at[1],0,0,1])),inverse=full.inverse(),planeInverse=frame.h.inverse();if(!inverse||!planeInverse)return;
  const q=scene.planes[plane].corners,x0=clamp(Math.floor(Math.min(...q.map(p=>p[0]))),0,image.width),x1=clamp(Math.ceil(Math.max(...q.map(p=>p[0]))),0,image.width),y0=clamp(Math.floor(Math.min(...q.map(p=>p[1]))),0,image.height),y1=clamp(Math.ceil(Math.max(...q.map(p=>p[1]))),0,image.height);
  let sampleSrc=src,sampleFull=full,sampleScale=1;const reduction=full.localScale(src.width/2,src.height/2);if(reduction>0&&reduction<.999){sampleScale=Math.max(reduction,1/64);const reduced=reduceRgba(src.data,src.width,src.height,sampleScale);sampleSrc={width:reduced.width,height:reduced.height,data:reduced.data};sampleFull=full.multiply(new Homography([1/sampleScale,0,0,0,1/sampleScale,0,0,0,1]));}
  const sampleInverse=sampleFull.inverse();if(!sampleInverse)return;
  for(let ty=y0;ty<y1;ty+=128)for(let tx=x0;tx<x1;tx+=128){const right=Math.min(x1,tx+128),bottom=Math.min(y1,ty+128),mx=(tx+right)/2,my=(ty+bottom)/2,o=sampleInverse.apply(mx,my),dx=sampleInverse.apply(mx+1,my),dy=sampleInverse.apply(mx,my+1),extent=v=>Number.isFinite(v)&&v>1e-12?v:1,footU=extent(Math.abs(dx[0]-o[0])+Math.abs(dy[0]-o[0])),footV=extent(Math.abs(dx[1]-o[1])+Math.abs(dy[1]-o[1]));
    for(let y=ty;y<bottom;y++)for(let x=tx;x<right;x++){const [u,v]=planeInverse.apply(x+.5,y+.5);if(u<0||u>1||v<0||v>1)continue;const [sx,sy]=sampleInverse.apply(x+.5,y+.5),px=sx-.5,py=sy-.5;if(!Number.isFinite(px)||!Number.isFinite(py)||px< -1||py< -1||px>sampleSrc.width||py>sampleSrc.height)continue;const ix=Math.floor(px),iy=Math.floor(py),wx=cubic(px-ix),wy=cubic(py-iy),sum=[0,0,0,0];for(let j=0;j<4;j++)for(let k=0;k<4;k++){const xx=clamp(ix+k-1,0,sampleSrc.width-1),yy=clamp(iy+j-1,0,sampleSrc.height-1),i=(yy*sampleSrc.width+xx)*4,a=sampleSrc.data[i+3]/255,weight=wx[k]*wy[j];for(let c=0;c<3;c++)sum[c]+=sampleSrc.data[i+c]/255*a*weight;sum[3]+=a*weight;}const coverage=clamp(Math.min(sx,sampleSrc.width-sx)/footU+.5,0,1)*clamp(Math.min(sy,sampleSrc.height-sy)/footV+.5,0,1),alpha=clamp(sum[3]*coverage,0,1);if(alpha<=0)continue;const col=sum.slice(0,3).map(value=>clamp(value*coverage/alpha,0,1)).concat(alpha);over(image.data,(y*image.width+x)*4,col);}
  }
}
function sample(source,w,h,x,y){const x0=Math.floor(x),y0=Math.floor(y),tx=x-x0,ty=y-y0,result=[0,0,0,0];for(const [xx,yy,k]of [[x0,y0,(1-tx)*(1-ty)],[x0+1,y0,tx*(1-ty)],[x0,y0+1,(1-tx)*ty],[x0+1,y0+1,tx*ty]]){if(xx<0||yy<0||xx>=w||yy>=h)continue;const i=(yy*w+xx)*4;for(let c=0;c<4;c++)result[c]+=source[i+c]*k;}return result;}
function placeImage(image,left,top,right,bottom){
  const ox=image.x||0,oy=image.y||0,curL=ox,curT=oy,curR=ox+image.width,curB=oy+image.height;
  left=Math.min(curL,Math.floor(left));top=Math.min(curT,Math.floor(top));right=Math.max(curR,Math.ceil(right));bottom=Math.max(curB,Math.ceil(bottom));
  if(left===curL&&top===curT&&right===curR&&bottom===curB)return image;
  const width=right-left,height=bottom-top;
  if(width>32767||height>32767||width*height>64000000)throw Error('The clone stroke exceeds 32,767 pixels per side and 64 million pixels.');
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<image.height;y++)data.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),((y+oy-top)*width+(ox-left))*4);
  image.data=data;image.width=width;image.height=height;image.x=left;image.y=top;return image;
}
function cloneStroke(scene,image,entry){
  if(!point(entry.source)||!Array.isArray(entry.points)||entry.points.length>65536||entry.points.some(p=>!point(p)))throw Error('A clone stroke needs a source and a points array.');if(!entry.points.length)return image;const first=entry.points[0],ps=scene.planeAt(entry.source),pd=scene.planeAt(first);if(ps===null||pd===null)return image;const fs=scene.frame(ps),fd=scene.frame(pd),si=fs.h.inverse(),di=fd.h.inverse();if(!si||!di)return image;const metric=(inv,frame,p)=>{const [u,v]=inv.apply(...p);return[u*frame.width,v*frame.height];},ms=metric(si,fs,entry.source),md=metric(di,fd,first),offset=[ms[0]-md[0],ms[1]-md[1]],size=clamp(finite(entry.size,40),1,2000),probe=metric(di,fd,[first[0]+size/2,first[1]]),radius=Math.max(1e-9,Math.hypot(probe[0]-md[0],probe[1]-md[1])),hard=clamp(finite(entry.hardness,50)/100,0,.99),opacity=clamp(finite(entry.opacity,100)/100,0,1);
  const dabs=[];
  for(const p of entry.points){const center=metric(di,fd,p),boundary=Array.from({length:16},(_,k)=>{const a=k/16*Math.PI*2;return fd.h.apply((center[0]+radius*Math.cos(a))/fd.width,(center[1]+radius*Math.sin(a))/fd.height);});if(boundary.some(q=>q.some(v=>!Number.isFinite(v))))continue;const rawX0=Math.floor(Math.min(...boundary.map(q=>q[0]))),rawY0=Math.floor(Math.min(...boundary.map(q=>q[1]))),rawX1=Math.ceil(Math.max(...boundary.map(q=>q[0])))+1,rawY1=Math.ceil(Math.max(...boundary.map(q=>q[1])))+1;if(rawX1-rawX0>4096||rawY1-rawY0>4096)continue;dabs.push({center,rawX0,rawY0,rawX1,rawY1});}
  if(!dabs.length)return image;
  placeImage(image,Math.min(...dabs.map(d=>d.rawX0)),Math.min(...dabs.map(d=>d.rawY0)),Math.max(...dabs.map(d=>d.rawX1)),Math.max(...dabs.map(d=>d.rawY1)));
  const source=new Uint8ClampedArray(image.data),ox=image.x||0,oy=image.y||0;
  for(const dab of dabs)for(let y=dab.rawY0;y<dab.rawY1;y++)for(let x=dab.rawX0;x<dab.rawX1;x++){const bx=x-ox,by=y-oy;if(bx<0||by<0||bx>=image.width||by>=image.height)continue;const m=metric(di,fd,[x+.5,y+.5]),d=Math.hypot(m[0]-dab.center[0],m[1]-dab.center[1])/radius;if(!Number.isFinite(d)||d>=1)continue;const fall=d<=hard?1:1-(d-hard)/(1-hard),weight=fall*fall*(3-2*fall)*opacity,[sx,sy]=fs.h.apply((m[0]+offset[0])/fs.width,(m[1]+offset[1])/fs.height);if(!Number.isFinite(sx)||!Number.isFinite(sy))continue;const col=sample(source,image.width,image.height,sx-ox-.5,sy-oy-.5),i=(by*image.width+bx)*4;for(let c=0;c<4;c++)image.data[i+c]+=(col[c]-image.data[i+c])*weight;}
  return image;
}
export function vanishingPoint(image,settings={}){
  const scene=vanishingScene(settings,image.width,image.height),pastes=settings.pastes||[],clones=typeof settings.clones==='string'?JSON.parse(settings.clones):settings.clones||[];if(!Array.isArray(pastes)||pastes.length>128||!Array.isArray(clones)||clones.length>128)throw Error('Too many paste or clone operations.');for(const item of pastes)paste(scene,item,image);
  const base=settings.cloneBase;if(base&&(!Number.isInteger(base.width)||!Number.isInteger(base.height)||base.width<1||base.height<1||base.width>32767||base.height>32767||base.width*base.height>64000000||base.data?.length!==base.width*base.height*4))throw Error('The clone source dimensions changed.');
  let output=image;
  for(const entry of clones){
    if(!base){output=cloneStroke(scene,output,entry)||output;continue;}
    const work={width:output.width,height:output.height,x:output.x||0,y:output.y||0,data:new Uint8ClampedArray(output.width*output.height*4)};
    placeImage(work,0,0,base.width,base.height);
    for(let y=0;y<base.height;y++)work.data.set(base.data.subarray(y*base.width*4,(y+1)*base.width*4),((y-work.y)*work.width-work.x)*4);
    for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){const i=(y*output.width+x)*4,j=((y+(output.y||0)-work.y)*work.width+x+(output.x||0)-work.x)*4;over(work.data,j,[output.data[i]/255,output.data[i+1]/255,output.data[i+2]/255,output.data[i+3]/255]);}
    const before={width:work.width,height:work.height,x:work.x,y:work.y,data:new Uint8ClampedArray(work.data)},written=cloneStroke(scene,work,entry)||work;
    placeImage(output,written.x||0,written.y||0,(written.x||0)+written.width,(written.y||0)+written.height);
    for(let y=0;y<written.height;y++)for(let x=0;x<written.width;x++){
      const px=x+(written.x||0),py=y+(written.y||0),bx=px-before.x,by=py-before.y,i=(y*written.width+x)*4,b=bx>=0&&by>=0&&bx<before.width&&by<before.height?(by*before.width+bx)*4:-1;
      if([0,1,2,3].some(c=>written.data[i+c]!== (b<0?0:before.data[b+c]))){const o=((py-(output.y||0))*output.width+px-(output.x||0))*4;output.data.set(written.data.subarray(i,i+4),o);}
    }
  }

  return output;
}
