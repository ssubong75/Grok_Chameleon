export const MAX_PER_AXIS=31;
function axis(lo,hi,len){
  if(!len||!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return null;
  const index=value=>Math.trunc(Math.max(-1e9,Math.min(1e9,value))),first=index(Math.floor(lo/len)),last=index(Math.ceil(hi/len))-1;
  if(last-first<MAX_PER_AXIS)return [first,last];
  const mid=index(Math.floor((lo+hi)/2/len)),half=Math.floor(MAX_PER_AXIS/2);
  return [mid-half,mid+half];
}
export function patternCopies(visible,size){
  const xs=axis(visible[0],visible[2],size[0]),ys=axis(visible[1],visible[3],size[1]);
  if(!xs||!ys)return [];
  const out=[];
  for(let j=ys[0];j<=ys[1];j++)for(let i=xs[0];i<=xs[1];i++)if(i||j)out.push([i,j]);
  return out;
}
export function patternOffset(copy,size){return [copy[0]*size[0],copy[1]*size[1]];}
