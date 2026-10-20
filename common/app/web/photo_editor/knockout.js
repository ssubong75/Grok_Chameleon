// PhotoCraft compose/advanced.rs knockout, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
function mixPixel(backdrop, target, index, coverage){
  const k=Math.max(0,Math.min(1,coverage)),ba=backdrop[index+3]/255,ta=target?target[index+3]/255:0,alpha=ba+(ta-ba)*k;
  if(alpha<=0){backdrop[index]=backdrop[index+1]=backdrop[index+2]=backdrop[index+3]=0;return;}
  for(let channel=0;channel<3;channel++){const bp=backdrop[index+channel]/255*ba,tp=(target?target[index+channel]/255:0)*ta;backdrop[index+channel]=Math.max(0,Math.min(255,Math.round((bp+(tp-bp)*k)/alpha*255)));}
  backdrop[index+3]=Math.max(0,Math.min(255,Math.round(alpha*255)));
}
export function knockoutBackdrop(backdrop,target,shape){
  const destination=backdrop.data,reveal=target?.data||null,coverage=shape.data;
  for(let i=0;i<destination.length;i+=4)if(coverage[i+3]>0)mixPixel(destination,reveal,i,coverage[i+3]/255);
  return backdrop;
}
export function clipInside(before,after,base,opacity=1){
  const source=before.data,destination=after.data,mask=base.data,coverage=Math.max(0,Math.min(1,opacity));
  for(let i=0;i<destination.length;i+=4){
    const k=mask[i+3]/255*coverage;if(k>=1)continue;
    const ba=source[i+3]/255,aa=destination[i+3]/255,alpha=ba+(aa-ba)*k;
    if(alpha<=0){destination[i]=destination[i+1]=destination[i+2]=destination[i+3]=0;continue;}
    for(let channel=0;channel<3;channel++){const bp=source[i+channel]/255*ba,ap=destination[i+channel]/255*aa;destination[i+channel]=Math.max(0,Math.min(255,Math.round((bp+(ap-bp)*k)/alpha*255)));}
    destination[i+3]=Math.max(0,Math.min(255,Math.round(alpha*255)));
  }
  return after;
}
export function knockoutOpacity(result,before,knocked,opacity,shape){
  const rest=1-Math.max(0,Math.min(1,opacity));if(rest<=0||!knocked)return result;
  const current=result.data,original=before.data,replaced=knocked.data,coverage=shape.data;
  for(let i=0;i<current.length;i+=4){
    if(coverage[i+3]<=0)continue;
    const now=current[i+3]/255,was=original[i+3]/255,mid=replaced[i+3]/255,alpha=Math.max(0,Math.min(1,now+rest*(was-mid)));
    if(alpha<=0){current[i]=current[i+1]=current[i+2]=current[i+3]=0;continue;}
    for(let channel=0;channel<3;channel++){const value=current[i+channel]/255*now+rest*(original[i+channel]/255*was-replaced[i+channel]/255*mid);current[i+channel]=Math.max(0,Math.min(255,Math.round(value/alpha*255)));}
    current[i+3]=Math.round(alpha*255);
  }
  return result;
}
