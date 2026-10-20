// PhotoCraft crates/algo/src/panorama.rs seam_labels.

export function seamOrder(bounds,reference=0){
  const centre=b=>[(b.x0+b.x1)/2,(b.y0+b.y1)/2];
  const rc=centre(bounds[Math.min(reference,bounds.length-1)]);
  return bounds.map((_,i)=>i).sort((a,b)=>{
    if((a!==reference)-(b!==reference))return (a!==reference)-(b!==reference);
    const ca=centre(bounds[a]),cb=centre(bounds[b]);
    return Math.hypot(ca[0]-rc[0],ca[1]-rc[1])-Math.hypot(cb[0]-rc[0],cb[1]-rc[1]);
  });
}

export function seamLabels(w,h,luma,cover,order){
  const label=new Int32Array(w*h);label.fill(-1);
  for(const img of order){
    const cov=cover[img],overlap=new Uint8Array(w*h);
    let sx=0,sy=0,no=0,nx=0,ny=0,nn=0;
    for(let i=0;i<w*h;i++){
      if(!cov[i])continue;
      nx+=i%w;ny+=Math.floor(i/w);nn++;
      if(label[i]>=0){overlap[i]=1;sx+=i%w;sy+=Math.floor(i/w);no++;}
      else label[i]=img;
    }
    if(!no||nn===no)continue;
    const ox=sx/no,oy=sy/no,cx=nx/nn,cy=ny/nn,vertical=Math.abs(cx-ox)>=Math.abs(cy-oy),positive=vertical?cx>ox:cy>oy;
    const cost=i=>0.002+Math.abs(luma[img][i]-luma[label[i]][i]);
    const lines=vertical?h:w,len=vertical?w:h,idx=(line,k)=>vertical?line*w+k:k*w+line;
    const acc=new Float32Array(w*h);acc.fill(Infinity);const from=new Int32Array(w*h);from.fill(-1);
    let prev=null;
    for(let line=0;line<lines;line++){
      let any=false;for(let k=0;k<len;k++)if(overlap[idx(line,k)])any=true;
      if(!any)continue;
      for(let k=0;k<len;k++){
        const i=idx(line,k);if(!overlap[i])continue;
        let best=0,bk=-1;
        if(prev!=null&&prev+1===line){
          best=Infinity;
          for(const dk of [-1,0,1]){const kk=k+dk;if(kk<0||kk>=len)continue;const j=idx(prev,kk);if(acc[j]<best){best=acc[j];bk=kk;}}
          if(bk<0){best=0;bk=-1;}
        }
        acc[i]=best+cost(i);from[i]=bk;
      }
      prev=line;
    }
    const seam=Array(lines).fill(-1);
    for(let line=lines-1;line>=0;line--){
      if(seam[line]>=0)continue;
      let k=-1,best=Infinity;
      for(let t=0;t<len;t++)if(overlap[idx(line,t)]&&acc[idx(line,t)]<best){best=acc[idx(line,t)];k=t;}
      if(k<0)continue;
      let l=line;
      for(;;){
        seam[l]=k;const f=from[idx(l,k)];
        if(f<0||!l)break;
        l--;if(seam[l]>=0)break;k=f;
      }
    }
    for(let line=0;line<lines;line++){
      const s=seam[line];if(s<0)continue;
      for(let k=0;k<len;k++){const i=idx(line,k);if(overlap[i]&&(positive?k>s:k<s))label[i]=img;}
    }
  }
  return label;
}
