// PhotoCraft segment/slic.rs and subject.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {colorDistance} from './segment-cut.js';
export function segmentLab(rgb){const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,[r,g,b]=rgb.map(lin),f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116,x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);return[116*y-16,500*(x-y),200*(y-z)];}
function slic(lab,w,h,target){
  const n=w*h,step=Math.max(1,Math.sqrt(n/target)),centers=[],at=(x,y)=>lab[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))],gradient=(x,y)=>colorDistance(at(x-1,y),at(x+1,y))+colorDistance(at(x,y-1),at(x,y+1));
  for(let y=step/2;y<h;y+=step)for(let x=step/2;x<w;x+=step){const cx=Math.floor(x),cy=Math.floor(y);let bx=cx,by=cy,best=Infinity;for(let yy=Math.max(0,cy-1);yy<=Math.min(h-1,cy+1);yy++)for(let xx=Math.max(0,cx-1);xx<=Math.min(w-1,cx+1);xx++){const g=gradient(xx,yy);if(g<best){best=g;bx=xx;by=yy;}}centers.push([...at(bx,by),bx,by]);}
  if(!centers.length)centers.push([...lab[0],0,0]);
  const labels=new Int32Array(n).fill(-1),dist=new Float32Array(n),weight=(10/step)**2,r=Math.ceil(step);
  for(let iter=0;iter<8;iter++){
    dist.fill(Infinity);for(let k=0;k<centers.length;k++){const c=centers[k],cx=Math.round(c[3]),cy=Math.round(c[4]);for(let y=Math.max(0,cy-r);y<Math.min(h,cy+r+1);y++)for(let x=Math.max(0,cx-r);x<Math.min(w,cx+r+1);x++){const i=y*w+x,d=colorDistance(lab[i],c)+((x-c[3])**2+(y-c[4])**2)*weight;if(d<dist[i]){dist[i]=d;labels[i]=k;}}}
    const sums=centers.map(()=>new Float64Array(6));for(let i=0;i<n;i++){const l=labels[i];if(l<0)continue;const s=sums[l],p=lab[i];for(let c=0;c<3;c++)s[c]+=p[c];s[3]+=i%w;s[4]+=Math.floor(i/w);s[5]++;}for(let k=0;k<centers.length;k++)if(sums[k][5])centers[k]=Array.from(sums[k].subarray(0,5),v=>v/sums[k][5]);
  }
  for(let i=0;i<n;i++)if(labels[i]<0)labels[i]=i?labels[i-1]:0;
  const out=new Int32Array(n).fill(-1),queue=new Uint32Array(n),minimum=Math.floor(step*step/4);let count=0;
  for(let seed=0;seed<n;seed++){
    if(out[seed]>=0)continue;const sx=seed%w,sy=Math.floor(seed/w);let adjacent=-1;if(sx&&out[seed-1]>=0)adjacent=out[seed-1];if(sy&&out[seed-w]>=0)adjacent=out[seed-w];let head=0,end=1;queue[0]=seed;out[seed]=count;
    while(head<end){const i=queue[head++],x=i%w,y=Math.floor(i/w);for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1])if(j>=0&&out[j]<0&&labels[j]===labels[seed]){out[j]=count;queue[end++]=j;}}
    if(adjacent>=0&&end<minimum)for(let k=0;k<end;k++)out[queue[k]]=adjacent;else count++;
  }return{labels:out,count};
}
function blurLab(lab,w,h){let cur=lab;const at=(values,x,y)=>values[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];for(let iter=0;iter<2;iter++){const temp=new Array(lab.length),next=new Array(lab.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=at(cur,x-1,y),b=at(cur,x,y),c=at(cur,x+1,y);temp[y*w+x]=b.map((v,k)=>(a[k]+2*v+c[k])/4);}for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=at(temp,x,y-1),b=at(temp,x,y),c=at(temp,x,y+1);next[y*w+x]=b.map((v,k)=>(a[k]+2*v+c[k])/4);}cur=next;}return cur;}
export function subjectSaliency(pixels,w,h){
  const lab=pixels.map(segmentLab),sp=slic(lab,w,h,Math.max(16,Math.min(400,Math.floor(w*h/150)))),n=sp.count,mean=Array.from({length:n},()=>[0,0,0]),position=Array.from({length:n},()=>[0,0]),counts=new Uint32Array(n),border=new Uint8Array(n),adj=Array.from({length:n},()=>new Set());
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,l=sp.labels[i];for(let c=0;c<3;c++)mean[l][c]+=lab[i][c];position[l][0]+=x/w;position[l][1]+=y/h;counts[l]++;if(!x||!y||x+1===w||y+1===h)border[l]=1;for(const j of [x+1<w?i+1:-1,y+1<h?i+w:-1])if(j>=0){const q=sp.labels[j];if(q!==l){adj[l].add(q);adj[q].add(l);}}}
  for(let p=0;p<n;p++){mean[p]=mean[p].map(v=>v/Math.max(1,counts[p]));position[p]=position[p].map(v=>v/Math.max(1,counts[p]));}
  const appearance=(p,q)=>Math.sqrt(colorDistance(mean[p],mean[q])),wbg=new Float64Array(n),dist=new Float64Array(n),visited=new Uint8Array(n);
  // At most 400 regions: a dense Dijkstra avoids heap allocation for every relaxation.
  for(let p=0;p<n;p++){
    dist.fill(Infinity);visited.fill(0);dist[p]=0;for(let iter=0;iter<n;iter++){let u=-1,best=Infinity;for(let q=0;q<n;q++)if(!visited[q]&&dist[q]<best){u=q;best=dist[q];}if(u<0)break;visited[u]=1;for(const q of adj[u])dist[q]=Math.min(dist[q],best+appearance(u,q));}
    let area=0,length=0;for(let q=0;q<n;q++){const s=Math.exp(-dist[q]*dist[q]/200);area+=s;if(border[q])length+=s;}const connectivity=length/Math.sqrt(Math.max(1e-6,area));wbg[p]=1-Math.exp(-connectivity*connectivity/2);
  }
  const contrast=new Float64Array(n);let maximum=1e-6;for(let p=0;p<n;p++){for(let q=0;q<n;q++){const dx=position[p][0]-position[q][0],dy=position[p][1]-position[q][1];contrast[p]+=appearance(p,q)*Math.exp(-(dx*dx+dy*dy)/.125)*wbg[q];}maximum=Math.max(maximum,contrast[p]);}
  const wfg=contrast.map(v=>v/maximum),saliency=new Float64Array(wfg),weights=adj.map((set,p)=>Array.from(set,q=>[q,Math.exp(-(appearance(p,q)**2)/200)+.1]));
  for(let iter=0;iter<200;iter++)for(let p=0;p<n;p++){let num=wfg[p],den=wbg[p]+wfg[p];for(const [q,weight]of weights[p]){num+=weight*saliency[q];den+=weight;}saliency[p]=num/Math.max(1e-6,den);}
  const overall=[0,0,0];for(const p of lab)for(let c=0;c<3;c++)overall[c]+=p[c]/lab.length;const ft=Float32Array.from(blurLab(lab,w,h),c=>Math.sqrt(colorDistance(c,overall)));let ftmax=1e-6,smin=Infinity,smax=-Infinity;for(const v of ft)ftmax=Math.max(ftmax,v);for(const v of saliency){smin=Math.min(smin,v);smax=Math.max(smax,v);}const range=Math.max(1e-6,smax-smin),out=Float32Array.from(sp.labels,(l,i)=>.75*(saliency[l]-smin)/range+.25*ft[i]/ftmax);let low=Infinity,high=-Infinity;for(const v of out){low=Math.min(low,v);high=Math.max(high,v);}const span=Math.max(1e-6,high-low);return out.map(v=>(v-low)/span);
}
export function otsu(values){const hist=new Uint32Array(256);for(const v of values)hist[Math.round(Math.max(0,Math.min(1,v))*255)]++;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let wb=0,sb=0,best=-1,threshold=0;for(let t=0;t<256;t++){wb+=hist[t];if(!wb)continue;const wf=values.length-wb;if(!wf)break;sb+=t*hist[t];const delta=sb/wb-(sum-sb)/wf,variance=wb*wf*delta*delta;if(variance>best){best=variance;threshold=t;}}return(threshold+.5)/255;}
