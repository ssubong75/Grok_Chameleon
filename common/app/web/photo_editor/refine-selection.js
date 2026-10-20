// Guided colour matting and mask controls adapted from PhotoCraft algo/matting.rs.
import {clamp} from './photo-math.js';
import {boxMean} from './matting-math.js';
import {squareExtreme,shiftMask,gaussianMask,edgeDistance} from './mask-math.js';
export function guidedColor(image,mask,r,epsilon=.0001){const {width:w,height:h,data}=image,n=w*h,ch=Array.from({length:3},()=>new Float32Array(n));for(let i=0;i<n;i++)for(let c=0;c<3;c++)ch[c][i]=data[i*4+c]/255;const m=ch.map(c=>boxMean(c,w,h,r)),mp=boxMean(mask,w,h,r),mip=ch.map(c=>boxMean(c.map((v,i)=>v*mask[i]),w,h,r)),pairs=[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]],mii=pairs.map(([a,b])=>boxMean(ch[a].map((v,i)=>v*ch[b][i]),w,h,r)),av=Array.from({length:3},()=>new Float32Array(n)),bv=new Float32Array(n);
  for(let i=0;i<n;i++){const mu=m.map(c=>c[i]),s=(k,a,b)=>mii[k][i]-mu[a]*mu[b],rr=s(0,0,0)+epsilon,rg=s(1,0,1),rb=s(2,0,2),gg=s(3,1,1)+epsilon,gb=s(4,1,2),bb=s(5,2,2)+epsilon,cov=mip.map((c,k)=>c[i]-mu[k]*mp[i]),i00=gg*bb-gb*gb,i01=gb*rb-rg*bb,i02=rg*gb-gg*rb,i11=rr*bb-rb*rb,i12=rb*rg-rr*gb,i22=rr*gg-rg*rg,det=rr*i00+rg*i01+rb*i02;let a0=0,a1=0,a2=0;if(Math.abs(det)>=1e-30){a0=(i00*cov[0]+i01*cov[1]+i02*cov[2])/det;a1=(i01*cov[0]+i11*cov[1]+i12*cov[2])/det;a2=(i02*cov[0]+i12*cov[1]+i22*cov[2])/det;}av[0][i]=a0;av[1][i]=a1;av[2][i]=a2;bv[i]=mp[i]-a0*mu[0]-a1*mu[1]-a2*mu[2];}const ma=av.map(c=>boxMean(c,w,h,r)),mb=boxMean(bv,w,h,r),out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=ma[0][i]*ch[0][i]+ma[1][i]*ch[1][i]+ma[2][i]*ch[2][i]+mb[i];return out;
}
function edgeWidth(image,r){const {width:w,height:h,data}=image,n=w*h,y=new Float32Array(n),g=new Float32Array(n);for(let i=0;i<n;i++)y[i]=(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2])/255;for(let yy=0;yy<h;yy++)for(let x=0;x<w;x++){const gx=(y[yy*w+Math.min(w-1,x+1)]-y[yy*w+Math.max(0,x-1)])/2,gy=(y[Math.min(h-1,yy+1)*w+x]-y[Math.max(0,yy-1)*w+x])/2;g[yy*w+x]=Math.hypot(gx,gy);}const gm=squareExtreme(g,w,h,r,true),hi=squareExtreme(y,w,h,r,true),lo=squareExtreme(y,w,h,r,false);return hi.map((v,i)=>(v-lo[i])/Math.max(.0001,gm[i]));}
function cropRegion(image,mask,x,y,width,height){
  const data=new Uint8ClampedArray(width*height*4),coverage=new mask.constructor(width*height);
  for(let row=0;row<height;row++){const at=(y+row)*image.width+x;data.set(image.data.subarray(at*4,(at+width)*4),row*width*4);coverage.set(mask.subarray(at,at+width),row*width);}
  return{image:{width,height,data},mask:coverage};
}
function guidedRegion(image,mask,r,bounds={x:0,y:0,w:image.width,h:image.height}){
  const {x,y,w,h}=bounds,out=new Float32Array(w*h),halo=2*r;
  for(let yy=y;yy<y+h;yy+=512)for(let xx=x;xx<x+w;xx+=512){
    const tw=Math.min(512,x+w-xx),th=Math.min(512,y+h-yy),left=Math.max(0,xx-halo),top=Math.max(0,yy-halo),right=Math.min(image.width,xx+tw+halo),bottom=Math.min(image.height,yy+th+halo),region=cropRegion(image,mask,left,top,right-left,bottom-top),values=guidedColor(region.image,region.mask,r);
    for(let row=0;row<th;row++){const start=(yy-top+row)*region.image.width+xx-left;out.set(values.subarray(start,start+tw),(yy-y+row)*w+xx-x);}
  }
  return{data:out,x,y,w,h};
}
export function refineSelection(image,input,p={}){const {width:w,height:h}=image,n=w*h;if(input.length!==n)throw Error('Selection dimensions changed.');const m=Float32Array.from(input,v=>v/255),brush=p.brushMap;let hasRefineBrush=false,brushLeft=w,brushTop=h,brushRight=0,brushBottom=0;
  if(brush){if(!(brush instanceof Int16Array)||brush.length!==n)throw Error('Refine brush dimensions changed.');for(let i=0;i<n;i++){const code=brush[i];if(code>256){hasRefineBrush=true;const x=i%w,y=Math.floor(i/w);brushLeft=Math.min(brushLeft,x);brushTop=Math.min(brushTop,y);brushRight=Math.max(brushRight,x+1);brushBottom=Math.max(brushBottom,y+1);}else if(code>0)m[i]+=(1-m[i])*clamp(code/255);else if(code<0)m[i]*=1-clamp(-code/255);}}
  let a=new Float32Array(m);const radius=clamp(Number(p.radius)||0,0,64);if(radius>0){const binary=m.map(v=>v>=.5?1:0),boundary=new Uint8Array(n);let any=false;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,v=binary[i];if((x>0&&binary[i-1]!==v)||(x+1<w&&binary[i+1]!==v)||(y>0&&binary[i-w]!==v)||(y+1<h&&binary[i+w]!==v)){boundary[i]=1;any=true;}}if(any){const dist=edgeDistance(boundary,w,h),r=Math.max(1,Math.ceil(radius)),q=guidedRegion(image,m,r).data,widths=p.smartRadius?edgeWidth(image,r):null;for(let i=0;i<n;i++){const effective=widths?clamp(widths[i],1.5,Math.max(1.5,radius)):radius,weight=clamp(effective+1-dist[i]);if(weight)a[i]=m[i]+(clamp(q[i])-m[i])*weight;}}}
  if(hasRefineBrush){const r=Math.max(1,Math.ceil(clamp(Number(p.brushRadius)||8,1,64))),q=guidedRegion(image,m,r,{x:brushLeft,y:brushTop,w:brushRight-brushLeft,h:brushBottom-brushTop});for(let y=brushTop;y<brushBottom;y++)for(let x=brushLeft;x<brushRight;x++){const i=y*w+x;if(brush[i]>256){const weight=clamp((brush[i]-256)/255);a[i]+=(clamp(q.data[(y-q.y)*q.w+x-q.x])-a[i])*weight;}}}
  const sigma=clamp(Number(p.smooth)||0,0,100)/100*4;if(sigma>=.3){a=gaussianMask(a,w,h,sigma);for(let i=0;i<n;i++)a[i]=clamp((a[i]-.5)*(1+sigma)+.5);}a=gaussianMask(a,w,h,Math.max(0,Number(p.feather)||0)/2);const contrast=clamp(Number(p.contrast)||0,0,100);if(contrast){const gain=1/(1-.99*contrast/100);for(let i=0;i<n;i++)a[i]=clamp((a[i]-.5)*gain+.5);}const shift=clamp(clamp(Number(p.shiftEdge)||0,-100,100)/100*Math.max(4,radius),-64,64);if(Math.abs(shift)>=.0001)a=shiftMask(a,w,h,shift);return Uint8ClampedArray.from(a,v=>clamp(v)*255);
}
function decontaminateDense(image,mask,radius,amount=100){const {width:w,height:h,data}=image,n=w*h,r=Math.max(3,Math.ceil(radius)),factor=clamp(amount,0,100)/100,weights=new Float32Array(n);for(let i=0;i<n;i++)weights[i]=mask[i]/255>=.98?data[i*4+3]/255:0;const den=boxMean(weights,w,h,r),den2=boxMean(weights,w,h,r*4);for(let c=0;c<3;c++){const v=weights.map((weight,i)=>weight*data[i*4+c]),num=boxMean(v,w,h,r),num2=boxMean(v,w,h,r*4);for(let i=0;i<n;i++){const a=mask[i]/255;if(a<=.02||a>=.98)continue;const k=factor*clamp((1-a)*4),old=data[i*4+c],foreground=den[i]>.0001?num[i]/den[i]:den2[i]>.0001?num2[i]/den2[i]:old;data[i*4+c]=old+(foreground-old)*k;}}return image;}

export function decontaminateSelection(image,mask,radius,amount=100){
  if(image.width*image.height<=512*512)return decontaminateDense(image,mask,radius,amount);
  const halo=Math.max(3,Math.ceil(radius))*4;
  for(let y=0;y<image.height;y+=512)for(let x=0;x<image.width;x+=512){
    const w=Math.min(512,image.width-x),h=Math.min(512,image.height-y),left=Math.max(0,x-halo),top=Math.max(0,y-halo),right=Math.min(image.width,x+w+halo),bottom=Math.min(image.height,y+h+halo),region=cropRegion(image,mask,left,top,right-left,bottom-top);
    decontaminateDense(region.image,region.mask,radius,amount);
    for(let row=0;row<h;row++){const start=((y-top+row)*region.image.width+x-left)*4;image.data.set(region.image.data.subarray(start,start+w*4),((y+row)*image.width+x)*4);}
  }
  return image;
}
