// PhotoCraft doc/blend_if.rs and compose/lib.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
const FULL=[0,0,255,255];
const ramp=(lo,hi,x)=>hi<=lo?(x>=lo?1:0):Math.max(0,Math.min(1,(x-lo)/(hi-lo)));
export function blendRangeWeight(range,value){
  const lo=ramp(range[0],range[1],value),hi=ramp(255-range[3],255-range[2],255-value);
  return lo*hi;
}
export function blendIfLevel(value){
  const v=Math.max(0,Math.min(255,value)),rounded=Math.round(v);
  return Math.abs(v-rounded)<1e-4?rounded:v;
}
function rangeAt(ranges,index,side){
  const pair=ranges?.[index],range=pair?.[side];
  return range?.length===4?range:FULL;
}
export function blendIfActive(ranges){
  return Array.isArray(ranges)&&ranges.some(pair=>pair?.some(range=>range?.some((value,index)=>value!==FULL[index])));
}
export function blendIfWeight(ranges,thisPixel,underPixel,gray=false){
  let weight=1;
  for(const [pixel,side] of [[thisPixel,0],[underPixel,1]]){
    if(!pixel)continue;
    const level=channel=>blendIfLevel(pixel[channel]);
    if(gray){weight*=blendRangeWeight(rangeAt(ranges,0,side),level(0))*blendRangeWeight(rangeAt(ranges,1,side),level(0));}
    else{const grayLevel=0.299*level(0)+0.587*level(1)+0.114*level(2);weight*=blendRangeWeight(rangeAt(ranges,0,side),grayLevel);for(let channel=0;channel<3;channel++)weight*=blendRangeWeight(rangeAt(ranges,channel+1,side),level(channel));}
    if(weight<=0)return 0;
  }
  return weight;
}
export function channelWeights(excluded,gray=false){
  const mask=excluded>>>0;if(!mask)return null;
  const keep=bit=>mask&(1<<bit)?0:1,weights=gray?[keep(0),keep(0),keep(0)]:[keep(0),keep(1),keep(2)];
  return weights.every(value=>value===1)?null:weights;
}
export function applyBlendIf(before,after,own,ranges,gray=false){
  const destination=after.data,backdrop=before.data,source=own?.data;
  for(let i=0;i<destination.length;i+=4){
    const under=backdrop[i+3]>0?[backdrop[i],backdrop[i+1],backdrop[i+2]]:null;
    const mine=source?source[i+3]>0?[source[i],source[i+1],source[i+2]]:null:destination[i+3]>0?[destination[i],destination[i+1],destination[i+2]]:null;
    const weight=blendIfWeight(ranges,mine,under,gray);
    if(weight>=1)continue;
    const backdropAlpha=backdrop[i+3]/255,afterAlpha=destination[i+3]/255,alpha=backdropAlpha+(afterAlpha-backdropAlpha)*weight;
    if(alpha<=0){destination[i]=destination[i+1]=destination[i+2]=destination[i+3]=0;continue;}
    for(let channel=0;channel<3;channel++){const backdropPremultiplied=backdrop[i+channel]/255*backdropAlpha,afterPremultiplied=destination[i+channel]/255*afterAlpha;destination[i+channel]=Math.max(0,Math.min(255,Math.round((backdropPremultiplied+(afterPremultiplied-backdropPremultiplied)*weight)/alpha*255)));}
    destination[i+3]=Math.max(0,Math.min(255,Math.round(alpha*255)));
  }
  return after;
}
export function restoreChannels(before,after,weights){
  const destination=after.data,backdrop=before.data;
  for(let i=0;i<destination.length;i+=4)for(let channel=0;channel<3;channel++)destination[i+channel]=Math.max(0,Math.min(255,Math.round(backdrop[i+channel]+(destination[i+channel]-backdrop[i+channel])*weights[channel])));
  return after;
}
