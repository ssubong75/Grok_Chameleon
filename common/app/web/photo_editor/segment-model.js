// Adapted from PhotoCraft segment/gmm.rs and segment/mod.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
export const subsample=(samples,max)=>samples.filter((_,i)=>i%Math.max(1,Math.ceil(samples.length/max))===0);
class Rng{
  constructor(seed){this.state=BigInt.asUintN(64,BigInt(seed)*0x9e3779b97f4a7c15n)|1n;}
  next(){let x=this.state;x=BigInt.asUintN(64,x^(x<<13n));x^=x>>7n;x=BigInt.asUintN(64,x^(x<<17n));return this.state=x;}
  fraction(){return Number(this.next()>>40n)/16777216;}
}
function nearest(centers,z){let best=0,score=Infinity;for(let i=0;i<centers.length;i++){const d=distance(centers[i],z);if(d<score){score=d;best=i;}}return best;}
function centersFor(samples,k){
  const rng=new Rng(0x5eed+samples.length),centers=[samples[Number(rng.next()%BigInt(samples.length))]],dist=samples.map(z=>distance(z,centers[0]));
  while(centers.length<k){const total=dist.reduce((a,b)=>a+b,0);if(total<=1e-12)break;let t=rng.fraction()*total,pick=samples.length-1;for(let i=0;i<dist.length;i++){t-=dist[i];if(t<=0){pick=i;break;}}const c=samples[pick];centers.push(c);for(let i=0;i<samples.length;i++)dist[i]=Math.min(dist[i],distance(samples[i],c));}
  let result=centers;for(let iter=0;iter<10;iter++){
    const sums=result.map(()=>[0,0,0,0]);for(const z of samples){const s=sums[nearest(result,z)];for(let c=0;c<3;c++)s[c]+=z[c];s[3]++;}
    const next=sums.filter(s=>s[3]).map(s=>s.slice(0,3).map(v=>Math.fround(v/s[3]))),done=next.length===result.length&&next.every((z,i)=>z.every((v,c)=>v===result[i][c]));result=next;if(done)break;
  }return result;
}
const accumulator=()=>({n:0,sum:[0,0,0],squares:new Float64Array(9)});
function add(acc,z,weight){acc.n+=weight;for(let i=0;i<3;i++){acc.sum[i]+=weight*z[i];for(let j=0;j<3;j++)acc.squares[i*3+j]+=weight*z[i]*z[j];}}
function component(acc,total,reg){
  if(acc.n<=0)return null;const mean=acc.sum.map(v=>v/acc.n),c=Array.from(acc.squares,(v,i)=>v/acc.n-mean[Math.floor(i/3)]*mean[i%3]+(i%4===0?reg:0)),[a,b,d,e,f,g,h,i,j]=c;
  const det=a*(f*j-g*i)-b*(e*j-g*h)+d*(e*i-f*h),weight=acc.n/total;if(det<=1e-30||weight<=0)return null;
  return{mean:mean.map(Math.fround),inv:[f*j-g*i,d*i-b*j,b*g-d*f,g*h-e*j,a*j-d*h,d*e-a*g,e*i-f*h,b*h-a*i,a*f-b*e].map(v=>v/det),norm:Math.log(weight)-.5*Math.log(det)-1.5*Math.log(2*Math.PI)};
}
function weighted(c,z){const d=z.map((v,i)=>v-c.mean[i]),m=c.inv;return c.norm-.5*(d[0]*(m[0]*d[0]+m[1]*d[1]+m[2]*d[2])+d[1]*(m[3]*d[0]+m[4]*d[1]+m[5]*d[2])+d[2]*(m[6]*d[0]+m[7]*d[1]+m[8]*d[2]));}
export function fitColorModel(samples,k=3,reg=1e-4){
  if(!samples.length)return null;const centers=centersFor(samples,Math.min(k,samples.length)),acc=centers.map(accumulator);for(const z of samples)add(acc[nearest(centers,z)],z,1);let comps=acc.map(a=>component(a,samples.length,reg)).filter(Boolean);if(!comps.length)return null;
  for(let iter=0;iter<3;iter++){
    const sums=comps.map(accumulator);for(const z of samples){const logs=comps.map(c=>weighted(c,z)),max=Math.max(...logs),weights=logs.map(v=>Math.exp(v-max)),total=weights.reduce((a,b)=>a+b,0);for(let i=0;i<sums.length;i++){const r=weights[i]/total;if(r>1e-6)add(sums[i],z,r);}}
    const next=sums.map(a=>component(a,samples.length,reg)).filter(Boolean);if(next.length)comps=next;
  }
  return colorModel(comps,reg);
}
function colorModel(comps,reg){
  return{negativeLog(z){const logs=comps.map(c=>weighted(c,z)),max=Math.max(...logs),sum=logs.reduce((s,v)=>s+Math.exp(v-max),0);return Math.max(-50,Math.min(200,-max-Math.log(sum)));},
    refit(samples){if(!samples.length)return null;const sums=comps.map(accumulator);for(const z of samples){let best=0,score=-Infinity;for(let i=0;i<comps.length;i++){const v=weighted(comps[i],z);if(v>score){score=v;best=i;}}add(sums[best],z,1);}const next=sums.map(a=>component(a,samples.length,reg)).filter(Boolean);return next.length?colorModel(next,reg):null;}
  };
}
export function components(mask,w,h,diagonal){
  const labels=new Uint32Array(mask.length),sizes=[0],stack=new Uint32Array(mask.length);
  for(let seed=0;seed<mask.length;seed++){
    if(!mask[seed]||labels[seed])continue;const label=sizes.length;sizes.push(0);let count=1;stack[0]=seed;labels[seed]=label;
    while(count){const i=stack[--count],x=i%w,y=Math.floor(i/w);sizes[label]++;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||!diagonal&&dx&&dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const j=yy*w+xx;if(mask[j]&&!labels[j]){labels[j]=label;stack[count++]=j;}}}
  }return{labels,sizes};
}
export function cleanSegment(mask,w,h,fraction=.002,holeFraction=.01){
  const {labels,sizes}=components(mask,w,h,true);let largest=0;for(const size of sizes)largest=Math.max(largest,size);const minimum=Math.ceil(largest*fraction),out=Uint8Array.from(labels,label=>label&&sizes[label]>=minimum?1:0);let area=0;for(const value of out)area+=value;
  const holes=components(out.map(v=>1-v),w,h,false),touches=new Uint8Array(holes.sizes.length);for(let x=0;x<w;x++){touches[holes.labels[x]]=1;touches[holes.labels[(h-1)*w+x]]=1;}for(let y=0;y<h;y++){touches[holes.labels[y*w]]=1;touches[holes.labels[y*w+w-1]]=1;}
  const maximum=Math.floor(area*holeFraction);for(let i=0;i<out.length;i++){const label=holes.labels[i];if(label&&!touches[label]&&holes.sizes[label]<=maximum)out[i]=1;}return out;
}

export function keepSeeded(mask,seeds,w,h){const {labels,sizes}=components(mask,w,h,true),keep=new Uint8Array(sizes.length);for(let i=0;i<labels.length;i++)if(seeds[i]&&labels[i])keep[labels[i]]=1;return Uint8Array.from(labels,l=>l&&keep[l]?1:0);}
export function fillModelHoles(mask,pixels,w,h,fg,bg,speckFraction=0,holeFraction=.05){
  const holes=components(mask.map(v=>v?0:1),w,h,false),touches=new Uint8Array(holes.sizes.length),costFg=new Float64Array(holes.sizes.length),costBg=new Float64Array(holes.sizes.length);let area=0;for(const v of mask)area+=v?1:0;
  for(let x=0;x<w;x++){touches[holes.labels[x]]=1;touches[holes.labels[(h-1)*w+x]]=1;}for(let y=0;y<h;y++){touches[holes.labels[y*w]]=1;touches[holes.labels[y*w+w-1]]=1;}
  const maxHole=Math.floor(area*holeFraction),maxSpeck=Math.floor(area*speckFraction);
  for(let i=0;i<mask.length;i++){const l=holes.labels[i],size=holes.sizes[l];if(!l||touches[l]||size>maxHole||size<=maxSpeck)continue;costFg[l]+=fg.negativeLog(pixels[i]);costBg[l]+=bg.negativeLog(pixels[i]);}
  return Uint8Array.from(mask,(v,i)=>{const l=holes.labels[i];return v||l&&!touches[l]&&holes.sizes[l]<=maxHole&&(holes.sizes[l]<=maxSpeck||costFg[l]<=costBg[l])?1:0;});
}
