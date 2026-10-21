// PhotoCraft crates/algo/src/seam.rs: Avidan & Shamir seam carving.

const PROTECT_ENERGY=1e4;
const SEAM_SEARCH_MAX_HEIGHT=512;
const PROXY_SHRINK_MIN_HEIGHT=2048;
const PROXY_SHRINK_MIN_SEAMS=64;

function energyAt(img,stride,cw,h,ch,x,y){
  const xl=Math.max(0,x-1),xr=Math.min(cw-1,x+1),yu=Math.max(0,y-1),yd=Math.min(h-1,y+1);
  const at=(xx,yy,c)=>img[(yy*stride+xx)*ch+c];
  let s=0;
  for(let c=0;c<ch;c++){const v=at(x,y,c);s+=Math.abs(at(xr,y,c)-v)+Math.abs(v-at(xl,y,c));s+=Math.abs(at(x,yd,c)-v)+Math.abs(v-at(x,yu,c));}
  return s*0.5;
}

function energyMap(w,h,ch,img){
  const e=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)e[y*w+x]=energyAt(img,w,w,h,ch,x,y);
  return e;
}

class Dp{
  seam(stride,cw,h,energy){
    let cost=energy.slice(0,cw),next=new Float32Array(cw);
    const from=new Uint8Array(cw*h);
    for(let y=1;y<h;y++){
      const e=energy.subarray(y*stride,y*stride+cw);
      if(cw===1){next[0]=cost[0]+e[0];from[y*cw]=1;}
      else{
        if(cost[1]<cost[0]){next[0]=cost[1]+e[0];from[y*cw]=2;}else{next[0]=cost[0]+e[0];from[y*cw]=1;}
        for(let x=1;x<cw-1;x++){
          let b=cost[x],d=1;
          if(cost[x-1]<b){b=cost[x-1];d=0;}
          if(cost[x+1]<b){b=cost[x+1];d=2;}
          next[x]=b+e[x];from[y*cw+x]=d;
        }
        if(cost[cw-2]<cost[cw-1]){next[cw-1]=cost[cw-2]+e[cw-1];from[y*cw+cw-1]=0;}else{next[cw-1]=cost[cw-1]+e[cw-1];from[y*cw+cw-1]=1;}
      }
      const swap=cost;cost=next;next=swap;
    }
    let x=0;for(let i=1;i<cw;i++)if(cost[i]<cost[x])x=i;
    const seam=new Array(h);
    for(let y=h-1;y>=0;y--){seam[y]=x;if(y>0){const f=from[y*cw+x];x=f===0?x-1:f===2?x+1:x;}}
    return seam;
  }
}

function shiftRows(buf,rowLen,seam,n,cw){
  for(let y=0;y<seam.length;y++){const x=seam[y],row=y*rowLen;buf.copyWithin(row+x*n,row+(x+1)*n,row+cw*n);}
}

class Carver{
  constructor(w,h,ch,img,prot,track){
    const e=energyMap(w,h,ch,img);
    if(prot)for(let i=0;i<e.length;i++)e[i]+=Math.max(0,Math.min(1,prot[i]))*PROTECT_ENERGY;
    this.stride=w;this.cw=w;this.h=h;this.ch=ch;this.img=img;this.prot=prot;this.e=e;this.dp=new Dp();
    this.idx=track?Int32Array.from({length:h*w},(_,i)=>i%w):null;
  }
  removeSeam(){
    const {stride,cw,h,ch}=this,seam=this.dp.seam(stride,cw,h,this.e);
    const removed=this.idx?seam.map((x,y)=>this.idx[y*stride+x]):seam.slice();
    shiftRows(this.img,stride*ch,seam,ch,cw);
    shiftRows(this.e,stride,seam,1,cw);
    if(this.prot)shiftRows(this.prot,stride,seam,1,cw);
    if(this.idx)shiftRows(this.idx,stride,seam,1,cw);
    this.cw-=1;
    this.updateEnergy(seam);
    return removed;
  }
  updateEnergy(seam){
    const {stride,cw,h,ch}=this;
    if(!cw)return;
    for(let y=0;y<h;y++){
      const y0=Math.max(0,y-1),y1=Math.min(h-1,y+1);
      let lo=cw,hi=0;
      for(let yy=y0;yy<=y1;yy++){lo=Math.min(lo,seam[yy]);hi=Math.max(hi,seam[yy]);}
      lo=Math.max(0,lo-1);hi=Math.min(cw-1,hi);
      for(let x=lo;x<=hi;x++){
        let v=energyAt(this.img,stride,cw,h,ch,x,y);
        if(this.prot)v+=Math.max(0,Math.min(1,this.prot[y*stride+x]))*PROTECT_ENERGY;
        this.e[y*stride+x]=v;
      }
    }
  }
  pixels(){
    const row=this.stride*this.ch,used=this.cw*this.ch;
    if(row===used)return this.img;
    const out=new Float32Array(this.cw*this.h*this.ch);
    for(let y=0;y<this.h;y++)out.set(this.img.subarray(y*row,y*row+used),y*used);
    return out;
  }
}

function transpose(w,h,ch,img){
  const out=new Float32Array(img.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=(y*w+x)*ch,d=(x*h+y)*ch;for(let c=0;c<ch;c++)out[d+c]=img[s+c];}
  return out;
}

export function resizeBilinear(w,h,ch,img,nw,nh){
  const out=new Float32Array(nw*nh*ch);
  if(!w||!h)return out;
  for(let y=0;y<nh;y++){
    const fy=Math.max(0,Math.min(h-1,(y+.5)*h/nh-.5)),y0=Math.floor(fy),ty=fy-y0,y1=Math.min(h-1,y0+1);
    for(let x=0;x<nw;x++){
      const fx=Math.max(0,Math.min(w-1,(x+.5)*w/nw-.5)),x0=Math.floor(fx),tx=fx-x0,x1=Math.min(w-1,x0+1);
      for(let c=0;c<ch;c++){
        const p=(xx,yy)=>img[(yy*w+xx)*ch+c];
        const top=p(x0,y0)+(p(x1,y0)-p(x0,y0))*tx,bot=p(x0,y1)+(p(x1,y1)-p(x0,y1))*tx;
        out[(y*nw+x)*ch+c]=top+(bot-top)*ty;
      }
    }
  }
  return out;
}

function carveWidthProxy(w,h,ch,img,protect,newW){
  const step=Math.ceil(h/SEAM_SEARCH_MAX_HEIGHT),proxyH=Math.ceil(h/step),rowLen=w*ch;
  const proxy=new Float32Array(proxyH*rowLen);
  for(let py=0;py<proxyH;py++){
    const y0=py*step,y1=Math.min(h,y0+step),div=y1-y0,out=proxy.subarray(py*rowLen,(py+1)*rowLen);
    for(let y=y0;y<y1;y++){const row=img.subarray(y*rowLen,(y+1)*rowLen);for(let i=0;i<rowLen;i++)out[i]+=row[i]/div;}
  }
  let proxyProtect=null;
  if(protect){
    proxyProtect=new Float32Array(proxyH*w);
    for(let py=0;py<proxyH;py++){
      const y0=py*step,y1=Math.min(h,y0+step),div=y1-y0,out=proxyProtect.subarray(py*w,(py+1)*w);
      for(let y=y0;y<y1;y++){const row=protect.subarray(y*w,(y+1)*w);for(let i=0;i<w;i++)out[i]+=row[i]/div;}
    }
  }
  const seamCount=w-newW,carver=new Carver(w,proxyH,ch,proxy,proxyProtect,true),removed=[];
  while(carver.cw>newW)removed.push(carver.removeSeam());
  const byRow=Array.from({length:proxyH},(_,py)=>removed.map(path=>path[py]).sort((a,b)=>a-b));
  const out=new Float32Array(newW*h*ch),columns=new Array(seamCount);
  for(let y=0;y<h;y++){
    const proxyY=Math.min(proxyH-1,Math.floor(y/step)),nextY=Math.min(proxyH-1,proxyY+1),blend=(y%step)/step;
    const lower=byRow[proxyY],upper=byRow[nextY];
    let minX=0;
    for(let i=0;i<seamCount;i++){
      const interpolated=lower[i]+(upper[i]-lower[i])*blend,maxX=w-(seamCount-i);
      columns[i]=Math.max(minX,Math.min(maxX,Math.round(interpolated)));
      minX=columns[i]+1;
    }
    let next=0;const row=img.subarray(y*rowLen,(y+1)*rowLen),dest=y*newW*ch;
    let o=0;
    for(let x=0;x<w;x++){
      if(columns[next]===x)next++;
      else{for(let c=0;c<ch;c++)out[dest+o*ch+c]=row[x*ch+c];o++;}
    }
  }
  return out;
}

function carveWidth(w,h,ch,img,protect,newW){
  newW=Math.max(1,newW);
  if(newW===w||!w||!h)return img.slice();
  if(newW<w){
    if(h>=PROXY_SHRINK_MIN_HEIGHT&&w-newW>=PROXY_SHRINK_MIN_SEAMS)return carveWidthProxy(w,h,ch,img,protect,newW);
    const carver=new Carver(w,h,ch,img.slice(),protect?protect.slice():null,false);
    while(carver.cw>newW)carver.removeSeam();
    return carver.pixels();
  }
  let cur=img.slice(),cw=w,prot=protect?protect.slice():null;
  while(cw<newW){
    const k=Math.min(newW-cw,Math.max(1,Math.floor(cw/2)));
    const carver=new Carver(cw,h,ch,cur.slice(),prot?prot.slice():null,true);
    const dup=Array.from({length:h},()=>[]);
    for(let n=0;n<k&&carver.cw;n++){const removed=carver.removeSeam();for(let y=0;y<h;y++)dup[y].push(removed[y]);}
    const added=dup[0].length;
    if(!added)break;
    const nw=cw+added,out=new Float32Array(nw*h*ch),nprot=prot?new Float32Array(nw*h):null;
    for(let y=0;y<h;y++){
      const d=dup[y].sort((a,b)=>a-b),row=cur.subarray(y*cw*ch,(y+1)*cw*ch);
      let di=0,o=y*nw*ch,po=y*nw;
      for(let x=0;x<cw;x++){
        for(let c=0;c<ch;c++)out[o++]=row[x*ch+c];
        if(nprot)nprot[po++]=prot[y*cw+x];
        while(di<d.length&&d[di]===x){
          const xr=Math.min(cw-1,x+1);
          for(let c=0;c<ch;c++)out[o++]=(row[x*ch+c]+row[xr*ch+c])*0.5;
          if(nprot)nprot[po++]=prot[y*cw+x];
          di++;
        }
      }
    }
    cur=out;prot=nprot;cw=nw;
  }
  return cur;
}

export function carve(w,h,ch,img,protect,newW,newH){
  newW=Math.max(1,newW);newH=Math.max(1,newH);
  const wide=carveWidth(w,h,ch,img,protect,newW);
  if(newH===h)return wide;
  const protT=protect?transpose(newW,h,1,resizeBilinear(w,h,1,protect,newW,h)):null;
  const tall=carveWidth(h,newW,ch,transpose(newW,h,ch,wide),protT,newH);
  return transpose(newH,newW,ch,tall);
}

export function reducedSides(w,h,nw,nh,maxSide){
  const k=Math.max(1,Math.max(w,h,nw,nh)/Math.max(1,maxSide));
  const side=v=>Math.max(1,Math.round(v/k));
  return [side(w),side(h),side(nw),side(nh)];
}

export function skinMask(w,h,ch,img){
  const m=new Float32Array(w*h);
  if(ch<3)return m;
  for(let i=0;i<m.length;i++){
    const r=img[i*ch]*255,g=img[i*ch+1]*255,b=img[i*ch+2]*255,mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(r>95&&g>40&&b>20&&mx-mn>15&&Math.abs(r-g)>15&&r>g&&r>b)m[i]=1;
  }
  return m;
}
export function scaleChannelBytes(w,h,ch,bytes,nw,nh,amount,protect,skinBytes){
  const img=new Float32Array(bytes.length);
  for(let i=0;i<bytes.length;i++)img[i]=bytes[i]/255;
  let guard=protect&&protect.length===w*h?Float32Array.from(protect):null;
  if(skinBytes&&skinBytes.length===w*h*4){
    const rgb=new Float32Array(skinBytes.length);
    for(let i=0;i<skinBytes.length;i++)rgb[i]=skinBytes[i]/255;
    const skin=skinMask(w,h,4,rgb);
    if(!guard)guard=skin;else for(let i=0;i<guard.length;i++)guard[i]=Math.max(guard[i],skin[i]);
  }
  const a=Math.max(0,Math.min(1,Number(amount)||0));
  const carved=a>0?carve(w,h,ch,img,guard,nw,nh):null;
  const plain=a<1?resizeBilinear(w,h,ch,img,nw,nh):null;
  const out=new Uint8Array(nw*nh*ch);
  for(let i=0;i<out.length;i++){
    const v=carved&&plain?plain[i]+(carved[i]-plain[i])*a:carved?carved[i]:plain[i];
    out[i]=Math.max(0,Math.min(255,Math.round(v*255)));
  }
  return out;
}
export function seamScale(image,nw,nh,amount,protect){
  const w=image.width,h=image.height,ch=4,img=new Float32Array(image.data.length);
  for(let i=0;i<image.data.length;i++)img[i]=image.data[i]/255;
  let guard=protect&&protect.length===w*h?Float32Array.from(protect):null;
  if(image.protectSkin){const skin=skinMask(w,h,ch,img);if(!guard)guard=skin;else for(let i=0;i<guard.length;i++)guard[i]=Math.max(guard[i],skin[i]);}
  const a=Math.max(0,Math.min(1,Number(amount)||0));
  const carved=a>0?carve(w,h,ch,img,guard,nw,nh):null;
  const plain=a<1?resizeBilinear(w,h,ch,img,nw,nh):null;
  const out=new Uint8ClampedArray(nw*nh*ch);
  for(let i=0;i<out.length;i++){
    const v=carved&&plain?plain[i]+(carved[i]-plain[i])*a:carved?carved[i]:plain[i];
    out[i]=Math.max(0,Math.min(255,Math.round(v*255)));
  }
  return new ImageData(out,nw,nh);
}
