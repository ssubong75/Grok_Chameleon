// PhotoCraft layer matting: defringe, black/white matte, and color decontamination.
const EMPTY=1e10;
function edt(outside,w,h){
  const n=w*h;if(!n||outside.length!==n)return new Float32Array(0);
  if(!outside.some(Boolean))return new Float32Array(n).fill(EMPTY);
  if(outside.every(Boolean))return new Float32Array(n);
  const vertical=new Uint32Array(n);const NO=0xffffffff;
  vertical.fill(NO);
  for(let x=0;x<w;x++){let nearest=-1;for(let y=0;y<h;y++){if(outside[y*w+x])nearest=y;if(nearest>=0)vertical[x*h+y]=y-nearest;}nearest=-1;for(let y=h-1;y>=0;y--){if(vertical[x*h+y]===0)nearest=y;if(nearest>=0)vertical[x*h+y]=Math.min(vertical[x*h+y],nearest-y);}}
  const out=new Float32Array(n),sites=new Uint32Array(w),starts=new Float64Array(w);
  for(let y=0;y<h;y++){
    const row=y*w;let count=0;
    for(let q=0;q<w;q++){const distance=vertical[q*h+y];if(distance===NO)continue;const fq=distance*distance;let start=-Infinity;while(count>0){const p=sites[count-1],dp=vertical[p*h+y];start=(fq-dp*dp)/(2*(q-p))+(q+p)*0.5;if(start>starts[count-1])break;count--;}
      if(count===0)start=-Infinity;sites[count]=q;starts[count]=start;count++;}
    if(!count){out.fill(EMPTY,row,row+w);continue;}
    let k=0;for(let x=0;x<w;x++){while(k+1<count&&starts[k+1]<x)k++;const site=sites[k],dy=vertical[site*h+y],dx=x-site;out[row+x]=Math.hypot(dx,dy);}
  }
  return out;
}
export function defringe(px,w,h,width){
  const n=w*h,outside=new Array(n);let any=false;
  for(let i=0;i<n;i++){outside[i]=px[i*4+3]<=0.01;any||=outside[i];}
  if(!any)return px;
  const dist=edt(outside,w,h),known=new Uint8Array(n),todo=[];
  for(let i=0;i<n;i++){if(outside[i])continue;if(dist[i]>width)known[i]=1;else todo.push(i);}
  const steps=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  while(todo.length){
    const next=[],updates=[];
    for(const i of todo){
      const x=i%w,y=(i/w)|0;let r=0,g=0,b=0,count=0;
      for(const [dx,dy] of steps){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(!known[j])continue;r+=px[j*4];g+=px[j*4+1];b+=px[j*4+2];count++;}
      if(count)updates.push([i,r/count,g/count,b/count]);else next.push(i);
    }
    if(!updates.length)break;
    for(const [i,r,g,b] of updates){px[i*4]=r;px[i*4+1]=g;px[i*4+2]=b;known[i]=1;}
    todo.length=0;todo.push(...next);
  }
  return px;
}
export function removeMatte(px,white){
  for(let i=0;i<px.length;i+=4){const a=px[i+3];if(a<=0||a>=1)continue;for(let c=0;c<3;c++){const v=white?(px[i+c]-(1-a))/a:px[i+c]/a;px[i+c]=Math.max(0,Math.min(1,v));}}
  return px;
}
export function boxMean(src,w,h,r){
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h),pre=new Float64Array(w+1),col=new Float64Array((h+1)*w);
  for(let y=0;y<h;y++){for(let x=0;x<w;x++)pre[x+1]=pre[x]+src[y*w+x];for(let x=0;x<w;x++){const lo=Math.max(0,x-r),hi=Math.min(w,x+r+1);tmp[y*w+x]=(pre[hi]-pre[lo])/(hi-lo);}}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)col[(y+1)*w+x]=col[y*w+x]+tmp[y*w+x];
  for(let y=0;y<h;y++){const lo=Math.max(0,y-r),hi=Math.min(h,y+r+1),n=hi-lo;for(let x=0;x<w;x++)out[y*w+x]=(col[hi*w+x]-col[lo*w+x])/n;}
  return out;
}
export function decontaminate(px,w,h,radius,amount){
  const n=w*h,rad=Math.ceil(Math.max(radius,3)),scale=Math.max(0,Math.min(100,amount))/100,channels=px.length/n-1;
  const alpha=new Float32Array(n),weights=new Float32Array(n);
  for(let i=0;i<n;i++){alpha[i]=px[i*(channels+1)+channels];weights[i]=alpha[i]>=0.98?alpha[i]:0;}
  const den=boxMean(weights,w,h,rad),den2=boxMean(weights,w,h,rad*4),nums=[];
  for(let c=0;c<channels;c++){const weighted=new Float32Array(n);for(let i=0;i<n;i++)weighted[i]=weights[i]*px[i*(channels+1)+c];nums.push([boxMean(weighted,w,h,rad),boxMean(weighted,w,h,rad*4)]);}
  for(let i=0;i<n;i++){const a=alpha[i],soft=a>0.02&&a<0.98,k=soft?scale*Math.max(0,Math.min(1,(1-a)*4)):0;if(!k)continue;for(let c=0;c<channels;c++){const v=px[i*(channels+1)+c],f=den[i]>1e-4?nums[c][0][i]/den[i]:den2[i]>1e-4?nums[c][1][i]/den2[i]:v;px[i*(channels+1)+c]=v+(f-v)*k;}}
  return px;
}
