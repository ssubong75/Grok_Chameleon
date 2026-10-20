const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function colorHalftone(image,settings={}){
  const {width,height,data}=image,maxRadius=clamp(Number(settings.maxRadius)||8,4,127),cell=maxRadius*Math.SQRT2,originX=Number(settings.x)||0,originY=Number(settings.y)||0,angles=['channel1','channel2','channel3','channel4'].map((key,index)=>Number.isFinite(Number(settings[key]))?Number(settings[key]):[108,162,90,45][index]),source=new Uint8ClampedArray(data);
  const read=(x,y,channel)=>source[(clamp(Math.floor(y-originY),0,height-1)*width+clamp(Math.floor(x-originX),0,width-1))*4+channel]/255;
  const value=(x,y,channel)=>{const distance=cell*.25;return [[0,0],[-distance,-distance],[distance,-distance],[-distance,distance],[distance,distance]].reduce((sum,[dx,dy])=>sum+read(x+dx,y+dy,channel),0)/5;};
  const screens=angles.slice(0,3).map(angle=>({s:Math.sin(angle*Math.PI/180),c:Math.cos(angle*Math.PI/180),radii:new Map}));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4,fx=x+.5+originX,fy=y+.5+originY;
    for(let channel=0;channel<3;channel++){
      const {s,c,radii}=screens[channel],u=fx*c+fy*s,v=-fx*s+fy*c,cu=Math.floor(u/cell),cv=Math.floor(v/cell);let coverage=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const gx=cu+dx,gy=cv+dy,mu=(gx+.5)*cell,mv=(gy+.5)*cell,d=Math.hypot(u-mu,v-mv);if(d>=maxRadius+.5)continue;
        const key=gx+','+gy;let radius=radii.get(key);
        if(radius===undefined){const px=mu*c-mv*s,py=mu*s+mv*c,ink=1-clamp(value(px,py,channel),0,1),touch=Math.PI/4;radius=ink<=touch?cell*Math.sqrt(ink/Math.PI):cell*(.5+(ink-touch)/(1-touch)*(Math.SQRT1_2-.5));if(radii.size<65536)radii.set(key,radius);}
        coverage=Math.max(coverage,Math.min(Math.PI*radius*radius,clamp(radius-d+.5,0,1)));
      }
      data[index+channel]=(1-coverage)*255;
    }
  }
  return image;
}
function hash01(x,y,channel,seed){let value=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(channel,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);value^=value>>>16;value=Math.imul(value,0x7feb352d);value^=value>>>15;value=Math.imul(value,0x846ca68b);value^=value>>>16;return(value>>>8)/16777216;}
export function crystallize(image,settings={}){
  const {width,height,data}=image,cell=Math.max(2,Number(settings.cellSize)||10),originX=Number(settings.x)||0,originY=Number(settings.y)||0,seed=(Number(settings.seed)||0)>>>0,source=new Uint8ClampedArray(data),point=(cx,cy)=>[(cx+.1+.8*hash01(cx,cy,11,seed))*cell,(cy+.1+.8*hash01(cx,cy,12,seed))*cell],owner=(x,y)=>{const fx=x+.5+originX,fy=y+.5+originY,cx=Math.floor(fx/cell),cy=Math.floor(fy/cell);let best=Infinity,result=[cx,cy];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const [px,py]=point(cx+dx,cy+dy),distance=(px-fx)**2+(py-fy)**2;if(distance<best){best=distance;result=[cx+dx,cy+dy];}}return result;},key=([cx,cy])=>cx+','+cy,averages=new Map;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const cellOwner=owner(x,y),[sampleX,sampleY]=point(...cellOwner),sx=Math.floor(sampleX)-originX,sy=Math.floor(sampleY)-originY;
    if(sx>=0&&sy>=0&&sx<width&&sy<height)continue;
    const cellKey=key(cellOwner),entry=averages.get(cellKey)||[0,0,0,0,0],pixel=(y*width+x)*4,alpha=source[pixel+3]/255;
    for(let channel=0;channel<3;channel++)entry[channel]+=source[pixel+channel]*alpha;
    entry[3]+=alpha;entry[4]++;averages.set(cellKey,entry);
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pixel=(y*width+x)*4,cellOwner=owner(x,y),[sampleX,sampleY]=point(...cellOwner),sx=Math.floor(sampleX)-originX,sy=Math.floor(sampleY)-originY;
    if(sx>=0&&sy>=0&&sx<width&&sy<height){data.set(source.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),pixel);continue;}
    const entry=averages.get(key(cellOwner));if(!entry||!entry[4])continue;
    const [red,green,blue,alpha,count]=entry;data[pixel+3]=alpha/count*255;data[pixel]=alpha?red/alpha:0;data[pixel+1]=alpha?green/alpha:0;data[pixel+2]=alpha?blue/alpha:0;
  }
  return image;
}
function color(value){const match=String(value||'').match(/^#([0-9a-f]{6})$/i);return match?[0,2,4].map(index=>parseInt(match[1].slice(index,index+2),16)): [255,255,255];}
export function pointillize(image,settings={}){
  const {width,height,data}=image,cell=Math.max(2,Number(settings.cellSize)||5),originX=Number(settings.x)||0,originY=Number(settings.y)||0,seed=(Number(settings.seed)||0)>>>0,background=color(settings.background),source=new Uint8ClampedArray(data),point=(cx,cy)=>[(cx+.1+.8*hash01(cx,cy,11,seed))*cell,(cy+.1+.8*hash01(cx,cy,12,seed))*cell];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4,fx=x+.5+originX,fy=y+.5+originY,cx=Math.floor(fx/cell),cy=Math.floor(fy/cell);let best=null;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const gx=cx+dx,gy=cy+dy,[px,py]=point(gx,gy),radius=cell*(.45+.35*hash01(gx,gy,13,seed)),depth=radius-Math.hypot(px-fx,py-fy);if(depth>-.5&&(!best||depth>best.depth))best={depth,gx,gy,px,py};}const alpha=source[index+3],canvas=[background[0],background[1],background[2],Math.max(alpha,255)];if(best){const sx=Math.floor(best.px)-originX,sy=Math.floor(best.py)-originY,sample=sx>=0&&sy>=0&&sx<width&&sy<height?source.subarray((sy*width+sx)*4,(sy*width+sx)*4+4):new Uint8ClampedArray(4),jitter=(hash01(best.gx,best.gy,17,seed)-.5)*.08*255,coverage=clamp(best.depth+.5,0,1);for(let channel=0;channel<3;channel++)canvas[channel]+=((clamp(sample[channel]+jitter,0,255))-canvas[channel])*coverage;canvas[3]+=(sample[3]-canvas[3])*coverage;}data.set(canvas,index);}
  return image;
}
function mezzoThreshold(kind,x,y,channel,seed){const lines=length=>{const phase=Math.floor(hash01(0,y,channel+40,seed)*length);return hash01(Math.floor((x+phase)/length),y,channel,seed);},strokes=length=>{const diagonal=x-y,phase=Math.floor(hash01(diagonal,0,channel+50,seed)*length);return hash01(Math.floor((x+y+phase)/length),diagonal,channel+60,seed);};switch(kind){case'mediumDots':return hash01(Math.floor(x/2),Math.floor(y/2),channel,seed);case'grainyDots':return .5*hash01(x,y,channel,seed)+.5*hash01(Math.floor(x/3),Math.floor(y/3),channel+7,seed);case'coarseDots':return hash01(Math.floor(x/3),Math.floor(y/3),channel,seed);case'shortLines':return lines(6);case'mediumLines':return lines(14);case'longLines':return lines(32);case'shortStrokes':return strokes(5);case'mediumStrokes':return strokes(10);case'longStrokes':return strokes(20);default:return hash01(x,y,channel,seed);}}
export function mezzotint(image,settings={}){const {data,width,height}=image,kind=['fineDots','mediumDots','grainyDots','coarseDots','shortLines','mediumLines','longLines','shortStrokes','mediumStrokes','longStrokes'].includes(settings.type)?settings.type:'fineDots',seed=(Number(settings.seed)||0)>>>0,originX=Number(settings.x)||0,originY=Number(settings.y)||0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4;for(let channel=0;channel<3;channel++)data[index+channel]=data[index+channel]/255>mezzoThreshold(kind,x+originX,y+originY,channel,seed)?255:0;}return image;}
