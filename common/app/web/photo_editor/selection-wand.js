// PhotoCraft selection.rs wand_region, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
export function wandCoverage(image,settings={}){
  const {width:w,height:h,data}=image,x=Math.floor(Number(settings.x)),y=Math.floor(Number(settings.y)),tolerance=Math.max(0,Math.min(255,Math.floor((Number(settings.tolerance)||0)+.001))),marks=new Uint8ClampedArray(w*h);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=w||y>=h)return marks;const seed=y*w+x,target=data.slice(seed*4,seed*4+4),matches=i=>{const p=i*4;if(target[3]===0&&data[p+3]===0)return true;for(let c=0;c<4;c++)if(Math.abs(data[p+c]-target[c])>tolerance)return false;return true;};let left=w,top=h,right=-1,bottom=-1;
  if(settings.contiguous!==false){
    const pending=[seed];while(pending.length){const i=pending.pop();if(marks[i])continue;const yy=Math.floor(i/w),sx=i%w;let l=sx,r=sx;while(l>0&&!marks[yy*w+l-1]&&matches(yy*w+l-1))l--;while(r+1<w&&!marks[yy*w+r+1]&&matches(yy*w+r+1))r++;marks.fill(255,yy*w+l,yy*w+r+1);left=Math.min(left,l);right=Math.max(right,r);top=Math.min(top,yy);bottom=Math.max(bottom,yy);
      for(const ny of [yy-1,yy+1]){if(ny<0||ny>=h)continue;let inRun=false;for(let xx=l;xx<=r;xx++){const j=ny*w+xx,ok=!marks[j]&&matches(j);if(ok&&!inRun)pending.push(j);inRun=ok;}}
    }
  }else for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(matches(yy*w+xx)){marks[yy*w+xx]=255;left=Math.min(left,xx);right=Math.max(right,xx);top=Math.min(top,yy);bottom=Math.max(bottom,yy);}
  if(settings.antiAlias===false||right<left)return marks;const out=new Uint8ClampedArray(marks);
  for(let yy=Math.max(0,top-1);yy<=Math.min(h-1,bottom+1);yy++)for(let xx=Math.max(0,left-1);xx<=Math.min(w-1,right+1);xx++){
    const i=yy*w+xx,v=marks[i];let sum=0,edge=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=xx+dx,ny=yy+dy,n=nx<0||ny<0||nx>=w||ny>=h?v:marks[ny*w+nx];sum+=n;if(n!==v)edge=true;}if(edge)out[i]=Math.round((v?127.5:0)+sum/18);
  }return out;
}
