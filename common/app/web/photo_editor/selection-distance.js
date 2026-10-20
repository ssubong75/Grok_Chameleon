// PhotoCraft selection/distance.rs and selection.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
export function selectionDistance(mask,w,h,selected=true,threshold=127.5){
  const vertical=new Uint32Array(w*h),none=0xffffffff;vertical.fill(none);
  for(let x=0;x<w;x++){
    let nearest=-1;for(let y=0;y<h;y++){if((mask[y*w+x]>=threshold)===selected)nearest=y;if(nearest>=0)vertical[x*h+y]=y-nearest;}
    nearest=-1;for(let y=h-1;y>=0;y--){if(vertical[x*h+y]===0)nearest=y;if(nearest>=0)vertical[x*h+y]=Math.min(vertical[x*h+y],nearest-y);}
  }
  const out=new Float32Array(w*h),sites=new Uint32Array(w),starts=new Float64Array(w);
  for(let y=0;y<h;y++){
    let count=0;
    for(let q=0;q<w;q++){
      const d=vertical[q*h+y];if(d===none)continue;let start=-Infinity;
      while(count){const prev=sites[count-1],dp=vertical[prev*h+y];start=(d*d-dp*dp)/(2*(q-prev))+(q+prev)*.5;if(start>starts[count-1])break;count--;}
      if(!count)start=-Infinity;sites[count]=q;starts[count++]=start;
    }
    if(!count){out.fill(1e10,y*w,(y+1)*w);continue;}
    let k=0;for(let x=0;x<w;x++){while(k+1<count&&starts[k+1]<x)k++;const site=sites[k],dy=vertical[site*h+y];out[y*w+x]=Math.hypot(x-site,dy);}
  }
  return out;
}
export function distanceCoverage(mask,w,h,r,operation,atBounds=false,placement='center'){
  const grow=operation==='expand',insideDistance=operation==='border'||grow?selectionDistance(mask,w,h,true):null,outsideDistance=operation==='border'||!grow?selectionDistance(mask,w,h,false):null,out=new Float32Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,inside=mask[i]>=127.5,edge=Math.min(x+1,y+1,w-x,h-y),outside=outsideDistance?Math.min(outsideDistance[i],atBounds?edge:Infinity):0;
    if(grow)out[i]=Math.max(mask[i],255*Math.max(0,Math.min(1,r+1-insideDistance[i])));
    else if(operation==='contract')out[i]=Math.min(mask[i],255*(1-Math.max(0,Math.min(1,r+1-outside))));
    else out[i]=(placement==='inside'&&!inside||placement==='outside'&&inside)?0:255*Math.max(0,Math.min(1,1-((inside?outside:insideDistance[i])-1)/r));
  }
  return out;
}
