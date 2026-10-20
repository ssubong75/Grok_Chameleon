// PhotoCraft compose/effects.rs edt_nearest / dist_outside_by(Euclidean).
export function outsideEffectDistance(shape,w,h,withSites=false){
  const count=w*h,columns=new Float64Array(count),nearestY=new Uint32Array(count),out=new Float32Array(count),limit=Math.max(w,h),sites=new Uint32Array(limit),starts=new Float64Array(limit),input=new Float64Array(limit),values=new Float64Array(limit),near=new Uint32Array(limit);
  const centers=withSites?new Float32Array(count):null,nearest=withSites?new Uint32Array(count):null;
  const transform=n=>{let used=0;for(let q=0;q<n;q++){if(input[q]>=1e19)continue;let start=-Infinity;while(used){const p=sites[used-1];start=((input[q]+q*q)-(input[p]+p*p))/(2*(q-p));if(start>starts[used-1])break;used--;}if(!used)start=-Infinity;sites[used]=q;starts[used++]=start;}if(!used){values.fill(1e20,0,n);near.fill(0,0,n);return;}let k=0;for(let x=0;x<n;x++){while(k+1<used&&starts[k+1]<x)k++;const q=sites[k];values[x]=(x-q)*(x-q)+input[q];near[x]=q;}};
  for(let x=0;x<w;x++){for(let y=0;y<h;y++)input[y]=shape[y*w+x]>.5/255?0:1e20;transform(h);for(let y=0;y<h;y++){columns[x*h+y]=values[y];nearestY[x*h+y]=near[y];}}
  for(let y=0;y<h;y++){for(let x=0;x<w;x++)input[x]=columns[x*h+y];transform(w);for(let x=0;x<w;x++){const i=y*w+x,px=near[x],index=nearestY[px*h+y]*w+px;if(withSites){centers[i]=Math.sqrt(values[x]);nearest[i]=index;}out[i]=shape[i]>.5/255?-.5:Math.sqrt(values[x])-.5+(1-Math.min(1,shape[index]||0));}}
  return withSites?{edge:out,centers,nearest}:out;
}
