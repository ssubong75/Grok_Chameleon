// PhotoCraft algo/matting.rs box_mean and guided_filter_gray, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
export function boxMean(input,w,h,r){
  r=Math.max(0,Math.round(r));if(!r)return new Float32Array(input);const temp=new Float32Array(input.length),out=new Float32Array(input.length);
  for(let y=0;y<h;y++){
    const row=y*w;let sum=0;for(let x=0;x<Math.min(w,r+1);x++)sum+=input[row+x];for(let x=0;x<w;x++){temp[row+x]=sum/(Math.min(w,x+r+1)-Math.max(0,x-r));if(x-r>=0)sum-=input[row+x-r];if(x+r+1<w)sum+=input[row+x+r+1];}
  }
  for(let x=0;x<w;x++){
    let sum=0;for(let y=0;y<Math.min(h,r+1);y++)sum+=temp[y*w+x];for(let y=0;y<h;y++){out[y*w+x]=sum/(Math.min(h,y+r+1)-Math.max(0,y-r));if(y-r>=0)sum-=temp[(y-r)*w+x];if(y+r+1<h)sum+=temp[(y+r+1)*w+x];}
  }return out;
}
export function guided(guide,input,w,h,r,epsilon){
  const meanI=boxMean(guide,w,h,r),meanP=boxMean(input,w,h,r),ip=new Float32Array(input.length),ii=new Float32Array(input.length);for(let i=0;i<input.length;i++){ip[i]=guide[i]*input[i];ii[i]=guide[i]*guide[i];}
  const meanIP=boxMean(ip,w,h,r),meanII=boxMean(ii,w,h,r),a=new Float32Array(input.length),b=new Float32Array(input.length);for(let i=0;i<a.length;i++){a[i]=(meanIP[i]-meanI[i]*meanP[i])/(meanII[i]-meanI[i]*meanI[i]+epsilon);b[i]=meanP[i]-a[i]*meanI[i];}
  const meanA=boxMean(a,w,h,r),meanB=boxMean(b,w,h,r);for(let i=0;i<a.length;i++)a[i]=meanA[i]*guide[i]+meanB[i];return a;
}
