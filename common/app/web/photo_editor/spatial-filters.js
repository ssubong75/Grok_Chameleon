import {extremePixels} from './selections.js';
import {deformPixels} from './deformations.js';
const limit=(v,min,max)=>Math.max(min,Math.min(max,v));
function blurred(image,radius){
  const {width,height,data}=image,count=width*height,input=new Float32Array(count*4),temp=new Float32Array(count*4),output=new Float32Array(count*4);
  radius=limit(Math.round(radius),1,2000);
  for(let i=0;i<count;i++){const a=data[i*4+3]/255;input[i*4]=data[i*4]*a;input[i*4+1]=data[i*4+1]*a;input[i*4+2]=data[i*4+2]*a;input[i*4+3]=a;}
  const pass=(source,target,horizontal)=>{const lines=horizontal?height:width,length=horizontal?width:height,index=(line,p)=>horizontal?(line*width+p)*4:(p*width+line)*4,divisor=radius*2+1;
    for(let line=0;line<lines;line++){const sums=[0,0,0,0];for(let p=0;p<=Math.min(radius,length-1);p++){const j=index(line,p);for(let c=0;c<4;c++)sums[c]+=source[j+c];}
      for(let p=0;p<length;p++){const j=index(line,p);for(let c=0;c<4;c++)target[j+c]=sums[c]/divisor;const remove=p-radius,add=p+radius+1;for(let c=0;c<4;c++){if(add<length)sums[c]+=source[index(line,add)+c];if(remove>=0)sums[c]-=source[index(line,remove)+c];}}}
  };pass(input,temp,true);pass(temp,output,false);
  for(let i=0;i<count;i++){const alpha=output[i*4+3];for(let c=0;c<3;c++)output[i*4+c]=alpha?output[i*4+c]/alpha:0;output[i*4+3]=alpha*255;}return output;
}
function gaussian(image,radius){const {width,height,data}=image,count=width*height,sigma=Math.max(.05,Number(radius)||0),extent=Math.ceil(sigma*3),kernel=[];let total=0;for(let offset=-extent;offset<=extent;offset++){const weight=Math.exp(-(offset*offset)/(2*sigma*sigma));kernel.push(weight);total+=weight;}for(let index=0;index<kernel.length;index++)kernel[index]/=total;const input=new Float32Array(count*4),temp=new Float32Array(count*4),output=new Float32Array(count*4);for(let pixel=0;pixel<count;pixel++){const alpha=data[pixel*4+3]/255;for(let channel=0;channel<3;channel++)input[pixel*4+channel]=data[pixel*4+channel]*alpha;input[pixel*4+3]=alpha;}const pass=(source,target,horizontal)=>{for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<4;channel++){let sum=0;for(let index=0;index<kernel.length;index++){const offset=index-extent,sx=horizontal?x+offset:x,sy=horizontal?y:y+offset;if(sx>=0&&sy>=0&&sx<width&&sy<height)sum+=source[(sy*width+sx)*4+channel]*kernel[index];}target[(y*width+x)*4+channel]=sum;}};pass(input,temp,true);pass(temp,output,false);for(let pixel=0;pixel<count;pixel++){const alpha=output[pixel*4+3];for(let channel=0;channel<3;channel++)output[pixel*4+channel]=alpha?output[pixel*4+channel]/alpha:0;output[pixel*4+3]=alpha*255;}return output;}
function gaussianBlur(image,radius){
  const sigma=limit(Number(radius)||0,0,1000);if(sigma<.05)return image.data;if(sigma<=4)return gaussian(image,sigma);
  const {width,height,data}=image,ideal=Math.sqrt(4*sigma*sigma+1);let lower=Math.floor(ideal);if(lower%2===0)lower--;lower=Math.max(1,lower);
  const upper=lower+2,m=limit(Math.round((12*sigma*sigma-3*lower*lower-12*lower-9)/(-4*lower-4)),0,3),radii=Array.from({length:3},(_,i)=>((i<m?lower:upper)-1)/2),reach=radii.reduce((a,b)=>a+b,0),input=new Float32Array(data.length),temp=new Float32Array(data.length),output=new Float32Array(data.length);
  for(let i=0;i<data.length;i+=4){const alpha=data[i+3]/255;for(let c=0;c<3;c++)input[i+c]=data[i+c]*alpha;input[i+3]=alpha;}
  const axis=(source,target,horizontal)=>{
    const length=horizontal?width:height,lines=horizontal?height:width,extended=length+reach*2,index=(line,p,c)=>horizontal?(line*width+p)*4+c:(p*width+line)*4+c;
    let lineBuffer=new Float64Array(extended),scratch=new Float64Array(extended);
    for(let line=0;line<lines;line++)for(let c=0;c<4;c++){
      lineBuffer.fill(0);for(let p=0;p<length;p++)lineBuffer[p+reach]=source[index(line,p,c)];
      for(const r of radii){const divisor=r*2+1;let sum=0;for(let p=0;p<=Math.min(r,extended-1);p++)sum+=lineBuffer[p];for(let p=0;p<extended;p++){scratch[p]=sum/divisor;if(p+r+1<extended)sum+=lineBuffer[p+r+1];if(p-r>=0)sum-=lineBuffer[p-r];}[lineBuffer,scratch]=[scratch,lineBuffer];}
      for(let p=0;p<length;p++)target[index(line,p,c)]=lineBuffer[p+reach];
    }
  };
  axis(input,temp,true);axis(temp,output,false);
  for(let i=0;i<data.length;i+=4){const alpha=output[i+3];for(let c=0;c<3;c++)output[i+c]=alpha>1e-7?output[i+c]/alpha:0;output[i+3]=alpha*255;}return output;
}
function sample(data,width,height,x,y,out,index){
  x=limit(x,0,width-1);y=limit(y,0,height-1);const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top;
  const points=[[left,top,(1-fx)*(1-fy)],[Math.min(width-1,left+1),top,fx*(1-fy)],[left,Math.min(height-1,top+1),(1-fx)*fy],[Math.min(width-1,left+1),Math.min(height-1,top+1),fx*fy]];
  let alpha=0;const rgb=[0,0,0];for(const [px,py,weight]of points){const j=(py*width+px)*4,a=data[j+3]/255*weight;alpha+=a;for(let c=0;c<3;c++)rgb[c]+=data[j+c]*a;}
  for(let c=0;c<3;c++)out[index+c]=alpha?rgb[c]/alpha:0;out[index+3]=alpha*255;
}
function sampleTransparent(data,width,height,x,y,out,index){
  const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top;
  const points=[[left,top,(1-fx)*(1-fy)],[left+1,top,fx*(1-fy)],[left,top+1,(1-fx)*fy],[left+1,top+1,fx*fy]];
  let alpha=0;const rgb=[0,0,0];for(const [px,py,weight]of points){if(px<0||py<0||px>=width||py>=height)continue;const j=(py*width+px)*4,a=data[j+3]/255*weight;alpha+=a;for(let c=0;c<3;c++)rgb[c]+=data[j+c]*a;}
  for(let c=0;c<3;c++)out[index+c]=alpha?rgb[c]/alpha:0;out[index+3]=alpha*255;
}
function smartBlur(image,settings){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),radius=limit(Number(settings.radius)||3,.1,100),threshold=limit(Number(settings.threshold)||25,.1,100),quality={low:4,medium:7,high:12}[settings.quality]||12,mode=['edgeOnly','overlayEdge'].includes(settings.mode)?settings.mode:'normal',whole=Math.ceil(radius),stride=Math.max(1,Math.ceil(whole/quality)),offsets=[];
  for(let dy=-whole;dy<=whole;dy+=stride)for(let dx=-whole;dx<=whole;dx+=stride)if(dx*dx+dy*dy<=radius*radius+.5)offsets.push([dx,dy]);
  const read=(x,y)=>x<0||y<0||x>=width||y>=height?[0,0,0,0]:source.slice((y*width+x)*4,(y*width+x)*4+4),differs=(a,b)=>[0,1,2].some(channel=>Math.abs(a[channel]-b[channel])>threshold);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4,center=source.slice(index,index+4);if(mode!=='normal'){const edge=[[1,0],[0,1],[-1,0],[0,-1]].some(([dx,dy])=>differs(read(x+dx,y+dy),center));if(edge||mode==='edgeOnly'){const value=edge?255:0;data[index]=data[index+1]=data[index+2]=value;data[index+3]=center[3];}continue;}let count=0,alpha=0,sum=[0,0,0];for(const [dx,dy]of offsets){const pixel=read(x+dx,y+dy);if(differs(pixel,center))continue;count++;const a=pixel[3]/255;alpha+=a;for(let channel=0;channel<3;channel++)sum[channel]+=pixel[channel]*a;}if(count){for(let channel=0;channel<3;channel++)data[index+channel]=alpha?sum[channel]/alpha:0;data[index+3]=alpha/count*255;}}
  return image;
}
function surfaceHistogram(image,source,radius,threshold){
  const {width,height,data}=image,reach=Math.min(255,Math.ceil(threshold));
  for(let y=0;y<height;y++)for(let channel=0;channel<3;channel++){
    const histogram=new Int32Array(256),top=Math.max(0,y-radius),bottom=Math.min(height-1,y+radius);
    const column=(x,sign)=>{if(x<0||x>=width)return;for(let yy=top;yy<=bottom;yy++){const index=(yy*width+x)*4;if(source[index+3])histogram[source[index+channel]]+=sign;}};
    for(let x=0;x<=Math.min(width-1,radius);x++)column(x,1);
    for(let x=0;x<width;x++){
      const index=(y*width+x)*4,center=source[index+channel];let sum=0,weight=0;
      for(let value=Math.max(0,center-reach);value<=Math.min(255,center+reach);value++){const count=histogram[value];if(!count)continue;const next=Math.max(0,1-Math.abs(value-center)/threshold)*count;sum+=value*next;weight+=next;}
      data[index+channel]=weight?sum/weight:center;column(x-radius,-1);column(x+radius+1,1);
    }
  }return true;
}
function hash01(x,y,c,seed){let h=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(c,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>8)/16777216;}
function radialBlur(image,settings){const {width,height,data}=image,source=new Uint8ClampedArray(data),amount=Math.max(1,Math.min(100,Number(settings.amount)||10)),method=settings.method==='zoom'?'zoom':'spin',quality={draft:64,good:256,best:4096}[settings.quality]||256,centerX=Number.isFinite(Number(settings.centerX))?Number(settings.centerX):.5,centerY=Number.isFinite(Number(settings.centerY))?Number(settings.centerY):.5,documentWidth=Number(settings.documentWidth)||width,documentHeight=Number(settings.documentHeight)||height,cx=documentWidth*centerX-(Number(settings.x)||0),cy=documentHeight*centerY-(Number(settings.y)||0),pixel=new Float64Array(4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x+.5-cx,dy=y+.5-cy,r=Math.hypot(dx,dy),length=(method==='spin'?amount*Math.PI/180:amount/200)*r,count=Math.max(1,Math.min(quality,Math.ceil(length)));let alpha=0,sum=[0,0,0];for(let step=0;step<=count;step++){let sx,sy;if(method==='spin'){const angle=(step/count-.5)*amount*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);sx=cx+dx*c-dy*s;sy=cy+dx*s+dy*c;}else{const k=1-amount/200*step/count;sx=cx+dx*k;sy=cy+dy*k;}sampleTransparent(source,width,height,sx-.5,sy-.5,pixel,0);const a=pixel[3]/255;alpha+=a;for(let channel=0;channel<3;channel++)sum[channel]+=pixel[channel]*a;}const index=(y*width+x)*4;for(let channel=0;channel<3;channel++)data[index+channel]=alpha?sum[channel]/alpha:0;data[index+3]=alpha/(count+1)*255;}return image;}
export function spatialFilter(image,name,amount){
  if(name==='Liquify'){deformPixels(image,amount);return true;}
  if(!['Blur','Add Noise','Mosaic','High Pass','Unsharp Mask','Smart Sharpen','Surface Blur','Smart Blur','Radial Blur','Median','Motion Blur','Twirl','Spherize','Ripple','Pinch','Polar Coordinates','Offset','Box Blur','Minimum','Maximum','Dust & Scratches','Facet','Fragment','Emboss','Find Edges'].includes(name))return false;
  const {data,width,height}=image,source=new Uint8ClampedArray(data),settings=typeof amount==='object'?amount:{};amount=Number(settings.amount??amount)||0;
  if(name==='Add Noise'){
    const seed=Number(settings.seed)||0,a=amount/100*.5;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(!data[i+3])continue;for(let c=0;c<3;c++){const ch=settings.monochromatic?0:c;
      const noise=settings.distribution==='gaussian'?Math.sqrt(-2*Math.log(Math.max(1e-7,hash01(x,y,ch*2+101,seed))))*Math.cos(Math.PI*2*hash01(x,y,ch*2+102,seed))*a*.5:(hash01(x,y,ch,seed)-.5)*2*a;data[i+c]+=noise*255;}}return true;
  }
  if(name==='Blur'){data.set(gaussianBlur(image,amount));return true;}
  if(name==='Box Blur'){data.set(blurred(image,amount));return true;}
  if(name==='Smart Blur'){smartBlur(image,settings);return true;}
  if(name==='Radial Blur'){radialBlur(image,settings);return true;}
  const get=(x,y,c)=>x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+c];
  if(name==='Surface Blur'){const radius=limit(Math.round(Number(settings.radius??amount)||0),0,100),threshold=Math.max(1,Number(settings.threshold)||1)*2.5,side=radius*2+1,reach=Math.min(255,Math.ceil(threshold));if(side*side>2*reach+1+4*side)return surfaceHistogram(image,source,radius,threshold);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const target=(y*width+x)*4;for(let channel=0;channel<3;channel++){const center=source[target+channel],limitValue=threshold;let sum=0,weight=0;for(let yy=y-radius;yy<=y+radius;yy++)for(let xx=x-radius;xx<=x+radius;xx++){if(get(xx,yy,3)<=0)continue;const value=get(xx,yy,channel),next=Math.max(0,1-Math.abs(value-center)/limitValue);sum+=value*next;weight+=next;}data[target+channel]=weight?sum/weight:center;}data[target+3]=source[target+3];}return true;}
  if(name==='Minimum'||name==='Maximum'){
    const radius=limit(Math.round(amount),1,500),plane=new Uint8Array(width*height);for(let c=0;c<4;c++){for(let i=0;i<plane.length;i++)plane[i]=source[i*4+c];const filtered=extremePixels(plane,width,height,radius,name==='Maximum');for(let i=0;i<plane.length;i++)data[i*4+c]=filtered[i];}return true;
  }
  if(name==='Emboss'){
    const angle=Number(settings.angle??135)*Math.PI/180,height=Math.max(1,Number(settings.height)||1),dx=Math.round(Math.cos(angle)*height),dy=Math.round(-Math.sin(angle)*height),strength=typeof settings.amount==='number'?settings.amount/100:1;
    const luma=(x,y)=>get(x,y,0)*.299+get(x,y,1)*.587+get(x,y,2)*.114;
    for(let y=0;y<image.height;y++)for(let x=0;x<width;x++){const value=127.5+strength*(luma(x+dx,y+dy)-luma(x-dx,y-dy)),i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;}return true;
  }
  if(name==='Find Edges'){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
      const gx=get(x+1,y-1,c)+2*get(x+1,y,c)+get(x+1,y+1,c)-get(x-1,y-1,c)-2*get(x-1,y,c)-get(x-1,y+1,c),gy=get(x-1,y+1,c)+2*get(x,y+1,c)+get(x+1,y+1,c)-get(x-1,y-1,c)-2*get(x,y-1,c)-get(x+1,y-1,c);data[(y*width+x)*4+c]=255-Math.hypot(gx,gy);
    }return true;
  }
  if(name==='Fragment'){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sums=[0,0,0];let alpha=0;for(const [dx,dy]of [[-4,0],[4,0],[0,-4],[0,4]]){const a=get(x+dx,y+dy,3)/255;alpha+=a;for(let c=0;c<3;c++)sums[c]+=get(x+dx,y+dy,c)*a;}const i=(y*width+x)*4;for(let c=0;c<3;c++)data[i+c]=alpha?sums[c]/alpha:0;data[i+3]=alpha/4*255;}return true;
  }
  if(name==='Facet'){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let best=Infinity,result=null;for(const [qx,qy]of [[-2,-2],[0,-2],[-2,0],[0,0]]){const sums=[0,0,0,0];let total=0,squares=0;for(let yy=y+qy;yy<=y+qy+2;yy++)for(let xx=x+qx;xx<=x+qx+2;xx++){const luma=get(xx,yy,0)*.299+get(xx,yy,1)*.587+get(xx,yy,2)*.114;total+=luma;squares+=luma*luma;for(let c=0;c<4;c++)sums[c]+=get(xx,yy,c);}const variance=squares/9-(total/9)**2;if(variance<best){best=variance;result=sums;}}const i=(y*width+x)*4;for(let c=0;c<4;c++)data[i+c]=result[c]/9;}return true;
  }
  if(name==='Offset'){
    const dx=Math.round(Number(settings.horizontal)||0),dy=Math.round(Number(settings.vertical)||0),edge=settings.edge||'wrap';
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sx=x-dx,sy=y-dy;const i=(y*width+x)*4;if(edge==='transparent'&&(sx<0||sy<0||sx>=width||sy>=height)){data.fill(0,i,i+4);continue;}if(edge==='wrap'){sx=((sx%width)+width)%width;sy=((sy%height)+height)%height;}else{sx=limit(sx,0,width-1);sy=limit(sy,0,height-1);}data.set(source.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),i);}return true;
  }
  if(name==='Mosaic'){
    const size=limit(Math.round(amount),1,500);
    for(let y=0;y<height;y+=size)for(let x=0;x<width;x+=size){const right=Math.min(width,x+size),bottom=Math.min(height,y+size),sum=[0,0,0];let alpha=0;
      for(let py=y;py<bottom;py++)for(let px=x;px<right;px++){const i=(py*width+px)*4,a=source[i+3]/255;alpha+=a;for(let c=0;c<3;c++)sum[c]+=source[i+c]*a;}
      for(let py=y;py<bottom;py++)for(let px=x;px<right;px++){const i=(py*width+px)*4;for(let c=0;c<3;c++)data[i+c]=alpha?sum[c]/alpha:0;data[i+3]=alpha/((right-x)*(bottom-y))*255;}
    }return true;
  }
  if(name==='Smart Sharpen'){
    const blur=gaussian(image,limit(Number(settings.radius)||1,.1,64)),strength=limit(Number(settings.amount)||100,1,500)/100,noise=limit(Number.isFinite(Number(settings.reduceNoise))?Number(settings.reduceNoise):10,0,100)/100;
    for(let i=0;i<data.length;i+=4){if(!source[i+3])continue;for(let c=0;c<3;c++){const difference=source[i+c]-blur[i+c],keep=1-noise*Math.exp(-Math.abs(difference)/255*40);data[i+c]=source[i+c]+strength*difference*keep;}}return true;
  }
  if(name==='High Pass'||name==='Unsharp Mask'){
    const blurredPixels=gaussian(image,name==='High Pass'?amount:Number(settings.radius)||2),threshold=Number(settings.threshold)||0;
    for(let i=0;i<data.length;i+=4){if(!source[i+3])continue;for(let c=0;c<3;c++){const difference=source[i+c]-blurredPixels[i+c];data[i+c]=name==='High Pass'?127.5+difference:Math.abs(difference)+.000255>=threshold?source[i+c]+difference*amount/100:source[i+c];}}return true;
  }
  if(name==='Median'||name==='Dust & Scratches'){
    const radius=limit(Math.round(settings.radius??amount),1,500),rows=[],threshold=Number(settings.threshold)||0;let count=0;for(let dy=-radius;dy<=radius;dy++){const half=Math.floor(Math.sqrt(radius*radius+radius-dy*dy));rows.push([dy,half]);count+=half*2+1;}
    for(let y=0;y<height;y++)for(let c=0;c<4;c++){const histogram=new Int32Array(256),blocks=new Int32Array(16),add=(x,yy,sign)=>{const value=get(x,yy,c);histogram[value]+=sign;blocks[value>>4]+=sign;};for(const [dy,half]of rows)for(let x=-half;x<=half;x++)add(x,y+dy,1);
      for(let x=0;x<width;x++){let rank=Math.floor(count/2),block=0;while(block<15&&rank>=blocks[block])rank-=blocks[block++];let value=block*16;while(value<255&&rank>=histogram[value])rank-=histogram[value++];const i=(y*width+x)*4+c;if(name==='Median'||Math.abs(source[i]-value)>threshold)data[i]=value;for(const [dy,half]of rows){add(x-half,y+dy,-1);add(x+half+1,y+dy,1);}}
    }return true;
  }
  if(name==='Motion Blur'){
    const distance=limit(Math.abs(amount),0,2000);if(distance<.5)return true;
    const angle=(Number(settings.angle)||0)*Math.PI/180,steps=Math.ceil(distance),cos=Math.cos(angle),sin=Math.sin(angle),taps=[],slots=new Map;
    for(let step=0;step<=steps;step++){
      const t=step/steps-.5,ox=cos*distance*t,oy=-sin*distance*t,left=Math.floor(ox),top=Math.floor(oy),tx=ox-left,ty=oy-top;
      for(const [dx,dy,weight]of [[0,0,(1-tx)*(1-ty)],[1,0,tx*(1-ty)],[0,1,(1-tx)*ty],[1,1,tx*ty]]){
        if(weight<=0)continue;const x=left+dx,y=top+dy,key=x+','+y;let index=slots.get(key);if(index===undefined){index=taps.length;slots.set(key,index);taps.push([x,y,0]);}taps[index][2]+=weight/(steps+1);
      }
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sum=[0,0,0];let alpha=0;for(const [dx,dy,weight]of taps){const a=get(x+dx,y+dy,3)/255*weight;alpha+=a;for(let c=0;c<3;c++)sum[c]+=get(x+dx,y+dy,c)*a;}
      const index=(y*width+x)*4;for(let c=0;c<3;c++)data[index+c]=alpha?sum[c]/alpha:0;data[index+3]=alpha*255;
    }return true;
  }
  if(['Twirl','Spherize','Ripple','Pinch','Polar Coordinates'].includes(name)){
    const originX=Number(settings.x)||0,originY=Number(settings.y)||0,documentWidth=Number(settings.documentWidth)||width,documentHeight=Number(settings.documentHeight)||height,cx=documentWidth/2-originX-.5,cy=documentHeight/2-originY-.5,hx=documentWidth/2,hy=documentHeight/2;
    const read=(x,y,c)=>{x=limit(x+originX,0,documentWidth-1)-originX;y=limit(y+originY,0,documentHeight-1)-originY;return x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+c];};
    const documentSample=(x,y,index)=>{const left=Math.floor(x),top=Math.floor(y),tx=x-left,ty=y-top,sum=[0,0,0];let alpha=0;for(const [px,py,weight]of [[left,top,(1-tx)*(1-ty)],[left+1,top,tx*(1-ty)],[left,top+1,(1-tx)*ty],[left+1,top+1,tx*ty]]){const a=read(px,py,3)/255*weight;alpha+=a;for(let c=0;c<3;c++)sum[c]+=read(px,py,c)*a;}for(let c=0;c<3;c++)data[index+c]=alpha?sum[c]/alpha:0;data[index+3]=alpha*255;};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dx=x-cx,dy=y-cy,u=dx/hx,v=dy/hy,ratio=Math.hypot(u,v);let sx=x,sy=y;
      const sphere=r=>{const a=limit(amount/100,-1,1),target=a>=0?Math.asin(r)*2/Math.PI:Math.sin(r*Math.PI/2);return r+Math.abs(a)*(target-r);};
      if(name==='Ripple'){const len=({small:8,medium:16,large:32})[settings.size]||16,amplitude=amount/100*len/8;sx=x+Math.sin((y+originY+.5)/len*Math.PI*2)*amplitude;sy=y+Math.sin((x+originX+.5)/len*Math.PI*2)*amplitude;}
      else if(name==='Polar Coordinates'){
        if(settings.mode==='rectangular'){const angle=(x+originX+1)/documentWidth*Math.PI*2,r=(y+originY)/documentHeight*Math.min(hx,hy);sx=documentWidth/2-r*Math.sin(angle)-originX;sy=documentHeight/2-r*Math.cos(angle)-originY;}
        else{let theta=Math.atan2(-(x+originX-documentWidth/2),-(y+originY-documentHeight/2));if(theta<=0)theta+=Math.PI*2;sx=theta/(Math.PI*2)*documentWidth-originX;sy=Math.hypot(x+originX-documentWidth/2,y+originY-documentHeight/2)/Math.min(hx,hy)*documentHeight-originY;}
      }
      else if(name==='Spherize'&&settings.mode==='horizontal'&&Math.abs(u)<1){sx=cx+Math.sign(u)*hx*sphere(Math.abs(u));}
      else if(name==='Spherize'&&settings.mode==='vertical'&&Math.abs(v)<1){sy=cy+Math.sign(v)*hy*sphere(Math.abs(v));}
      else if(ratio<1&&ratio>0){
        if(name==='Twirl'){const angle=(1-ratio)*amount*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);sx=cx+(u*c-v*s)*hx;sy=cy+(u*s+v*c)*hy;}
        else if(name==='Pinch'){const factor=ratio**(1-limit(amount/100,-1,1)*.5)/ratio;sx=cx+u*factor*hx;sy=cy+v*factor*hy;}
        else if(name==='Spherize'&&(!settings.mode||settings.mode==='normal')){const factor=sphere(ratio)/ratio;sx=cx+u*factor*hx;sy=cy+v*factor*hy;}
      }
      documentSample(sx,sy,(y*width+x)*4);
    }return true;
  }
  return false;
}
