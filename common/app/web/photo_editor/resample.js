import {adjustPixels} from './filters.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cover=(o,s)=>{const a=Math.floor(o/s+1e-9);return[a,Math.max(a+1,Math.floor((o+1)/s+1e-9))];};
function keys(method,scale){const s=clamp(scale,.25,1);return{type:'keys',a:method==='bicubicSmoother'?-.625-.5*(1-s):method==='bicubicSharper'?-1-1.6*(1-s):-.75,stretch:(method==='bicubicSmoother'?1.15:method==='bicubicSharper'?1.05:1)/s};}
function plan(method,sx,sy){const both=k=>[{sx,sy,kx:k,ky:k}],nearest={type:'nearest'};
  if(['nearest','bilinear','lanczos'].includes(method))return both({type:method});
  if(method==='preserveDetails')return sx>1||sy>1?both({type:'lanczos'}):plan('bicubicSharper',sx,sy);
  if(method==='bicubicAutomatic'){
    if(sx<=1&&sy<=1)return plan('bicubicSharper',sx,sy);if(sx>=1&&sy>=1)return plan('bicubicSmoother',sx,sy);
    return sx<1?[{sx,sy:1,kx:keys('bicubicSharper',sx),ky:nearest},{sx:1,sy,kx:nearest,ky:keys('bicubicSmoother',sy)}]:[{sx:1,sy,kx:nearest,ky:keys('bicubicSharper',sy)},{sx,sy:1,kx:keys('bicubicSmoother',sx),ky:nearest}];
  }
  const k=keys(method,sy!==1?sy:sx);return sx===1||sy===1?both(k):sy<sx?[{sx:1,sy,kx:k,ky:k},{sx,sy:1,kx:k,ky:k}]:[{sx,sy:1,kx:k,ky:k},{sx:1,sy,kx:k,ky:k}];
}
function weights(o,scale,kernel,edge){
  const constrain=v=>clamp(v,edge[0],Math.max(edge[0],edge[1]));
  if(scale===1||kernel.type==='nearest')return{start:Math.floor((o+.5)/scale),values:[1]};
  if(kernel.type==='bilinear'&&scale<.5){const [a,b]=cover(o,scale);return{start:a,values:Array(b-a).fill(1/(b-a))};}
  if(kernel.type==='keys'&&scale<.25){const inner=4*scale,innerEdge=[Math.ceil(edge[0]*inner-1e-9),Math.ceil((edge[1]+1)*inner-1e-9)-1],outer=weights(o,.25,kernel,innerEdge),boxes=outer.values.map((_,i)=>cover(clamp(outer.start+i,innerEdge[0],Math.max(innerEdge[0],innerEdge[1])),inner)),lo=Math.min(...boxes.map(b=>b[0])),hi=Math.max(...boxes.map(b=>b[1])),values=Array(hi-lo).fill(0);for(let i=0;i<boxes.length;i++){const [a,b]=boxes[i];for(let x=a;x<b;x++)values[x-lo]+=outer.values[i]/(b-a);}return{start:lo,values};}
  let u=constrain((o+.5)/scale-.5);if(kernel.type!=='lanczos'){const j=Math.floor(u);u=j+Math.round((u-j)*128)/128;}
  if(kernel.type==='bilinear'){const j=Math.floor(u);return{start:j,values:[1-(u-j),u-j]};}
  const stretch=kernel.type==='lanczos'?Math.max(1,1/scale):kernel.stretch,extent=(kernel.type==='lanczos'?3:2)*stretch,lo=kernel.type==='lanczos'?Math.ceil(u-extent):Math.floor(u-extent),hi=kernel.type==='lanczos'?Math.floor(u+extent):Math.ceil(u+extent),values=[];let total=0;
  for(let x=lo;x<=hi;x++){const d=Math.abs((x-u)/stretch),a=kernel.a;let value;if(kernel.type==='lanczos'){const p=Math.PI*d;value=d<1e-9?1:d<3?3*Math.sin(p)*Math.sin(p/3)/(p*p):0;}else value=d<1?(a+2)*d**3-(a+3)*d*d+1:d<2?a*(d**3-5*d*d+8*d-4):0;values.push(value);total+=value;}
  const factor=Math.abs(total)>1e-12?1/total:1;return{start:lo,values:values.map(v=>v*factor)};
}
function taps(start,end,scale,kernel,edge,content){return Array.from({length:end-start},(_,i)=>{const raw=weights(start+i,scale,kernel,edge),folded=new Map();for(let j=0;j<raw.values.length;j++){const x=clamp(raw.start+j,edge[0],edge[1]);if(x<content[0]||x>content[1]||!raw.values[j])continue;folded.set(x,(folded.get(x)||0)+raw.values[j]);}return Array.from(folded);});}
function pass(source,p,canvas){
  const x=Math.floor(source.x*p.sx),y=Math.floor(source.y*p.sy),w=Math.max(1,Math.ceil((source.x+source.width)*p.sx)-x),h=Math.max(1,Math.ceil((source.y+source.height)*p.sy)-y);
  if(w>32767||h>32767||w*h>64000000)throw Error('A resampled layer exceeds the image size limit.');
  const edgeX=[Math.min(source.x,canvas.x),Math.max(source.x+source.width,canvas.x+canvas.width)-1],edgeY=[Math.min(source.y,canvas.y),Math.max(source.y+source.height,canvas.y+canvas.height)-1],hx=taps(x,x+w,p.sx,p.kx,edgeX,[source.x,source.x+source.width-1]),vy=taps(y,y+h,p.sy,p.ky,edgeY,[source.y,source.y+source.height-1]),output=new Uint8ClampedArray(w*h*4),row=new Float32Array(w*4);
  // Stream source rows into small output bands to bound intermediate storage.
  const bandSize=Math.max(1,Math.min(32,Math.floor(1048576/(w*4))));
  for(let top=0;top<h;top+=bandSize){const rows=Math.min(bandSize,h-top),acc=new Float32Array(rows*w*4),uses=new Map();for(let j=0;j<rows;j++)for(const [sy,weight]of vy[top+j]){if(!uses.has(sy))uses.set(sy,[]);uses.get(sy).push([j,weight]);}
    for(const sy of [...uses.keys()].sort((a,b)=>a-b)){row.fill(0);for(let xx=0;xx<w;xx++)for(const [sx,weight]of hx[xx]){const i=((sy-source.y)*source.width+sx-source.x)*4,a=source.data[i+3]/255;for(let c=0;c<3;c++)row[xx*4+c]+=source.data[i+c]/255*a*weight;row[xx*4+3]+=a*weight;}for(const [j,weight]of uses.get(sy))for(let i=0;i<row.length;i++)acc[j*row.length+i]+=row[i]*weight;}
    for(let j=0;j<rows;j++)for(let xx=0;xx<w;xx++){const i=(j*w+xx)*4,o=((top+j)*w+xx)*4,a=acc[i+3];for(let c=0;c<3;c++)output[o+c]=a>1e-7?acc[i+c]/a*255:0;output[o+3]=a*255;}
  }
  return{x,y,width:w,height:h,data:output};
}
export function resamplePixels(image,x,y,sx,sy,method='bicubic',canvasWidth=image.width,canvasHeight=image.height){
  if(!['nearest','bilinear','bicubic','bicubicSmoother','bicubicSharper','bicubicAutomatic','lanczos','preserveDetails','automatic'].includes(method))throw Error('Choose a supported resampling method.');
  if(method==='automatic')method=sx>1||sy>1?'preserveDetails':'bicubicSharper';
  let current={...image,data:image.data,x,y,width:image.width,height:image.height},canvas={x:0,y:0,width:canvasWidth,height:canvasHeight};
  for(const p of plan(method,sx,sy)){current=pass(current,p,canvas);const x=Math.floor(canvas.x*p.sx),y=Math.floor(canvas.y*p.sy);canvas={x,y,width:Math.ceil((canvas.x+canvas.width)*p.sx)-x,height:Math.ceil((canvas.y+canvas.height)*p.sy)-y};}
  if(method==='preserveDetails'&&(sx>1||sy>1))adjustPixels(current,'Unsharp Mask',{amount:30,radius:.6*Math.max(sx,sy),threshold:0});
  return current;
}
