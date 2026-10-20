// PhotoCraft segment/mod.rs energy construction, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
// The residual solver uses an iterative Dinic blocking flow to avoid JavaScript call-stack limits.
const EPS=1e-8,neighbors=[[1,0,1],[0,1,1],[1,1,Math.SQRT2],[-1,1,Math.SQRT2]];
export const colorDistance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
export function contrastBeta(pixels,w,h){let sum=0,count=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(const [dx,dy]of neighbors){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy<h){sum+=colorDistance(pixels[y*w+x],pixels[yy*w+xx]);count++;}}return !count||sum<=1e-12?0:count/(2*sum);}
class Graph{
  constructor(nodes,edges){this.head=new Int32Array(nodes).fill(-1);this.next=new Int32Array(edges);this.to=new Uint32Array(edges);this.capacity=new Float64Array(edges);this.count=0;}
  edge(a,b,forward,reverse=0){const i=this.count;if(i+2>this.next.length)throw Error('Selection graph capacity exceeded.');this.to[i]=b;this.capacity[i]=forward;this.next[i]=this.head[a];this.head[a]=i;this.to[i+1]=a;this.capacity[i+1]=reverse;this.next[i+1]=this.head[b];this.head[b]=i+1;this.count+=2;}
  reachable(source,sink){
    const n=this.head.length,level=new Int32Array(n),queue=new Uint32Array(n),ptr=new Int32Array(n),nodes=new Uint32Array(n),path=new Int32Array(n),limit=new Float64Array(n),{head,next,to,capacity}=this;
    for(;;){
      level.fill(-1);level[source]=0;queue[0]=source;let front=0,end=1;
      while(front<end){const u=queue[front++];for(let e=head[u];e!==-1;e=next[e])if(capacity[e]>EPS&&level[to[e]]<0){level[to[e]]=level[u]+1;queue[end++]=to[e];}}
      if(level[sink]<0)return Uint8Array.from(level,v=>v>=0?1:0);
      ptr.set(head);nodes[0]=source;limit[0]=Infinity;let depth=0;
      for(;;){
        const u=nodes[depth];
        if(u===sink){
          const amount=limit[depth];let first=depth;
          for(let i=0;i<depth;i++){const e=path[i];capacity[e]=Math.max(0,capacity[e]-amount);capacity[e^1]+=amount;if(capacity[e]<=EPS)first=Math.min(first,i);}
          for(let i=1;i<=first;i++)limit[i]-=amount;
          depth=first;ptr[nodes[depth]]=next[path[depth]];continue;
        }
        let e=ptr[u];while(e!==-1&&(capacity[e]<=EPS||level[to[e]]!==level[u]+1))e=next[e];ptr[u]=e;
        if(e!==-1){path[depth]=e;nodes[depth+1]=to[e];limit[depth+1]=Math.min(limit[depth],capacity[e]);depth++;continue;}
        level[u]=-1;if(!depth)break;depth--;ptr[nodes[depth]]=next[path[depth]];
      }
    }
  }
}
export function gridCut(pixels,w,h,costForeground,costBackground,fixed,beta=contrastBeta(pixels,w,h),customWeight=null){
  const n=w*h,index=new Int32Array(n).fill(-1),out=Uint8Array.from(fixed,v=>v===1?1:0);let free=0;
  for(let i=0;i<n;i++)if(!fixed[i])index[i]=free++;if(!free)return out;
  const source=free,sink=free+1,graph=new Graph(free+2,free*12),fg=new Float64Array(free),bg=new Float64Array(free);
  for(let i=0;i<n;i++)if(index[i]>=0){fg[index[i]]=costForeground[i];bg[index[i]]=costBackground[i];}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,a=index[i];for(const [dx,dy,length]of neighbors){const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy>=h)continue;const j=yy*w+xx,b=index[j];if(a<0&&b<0)continue;
      const d2=colorDistance(pixels[i],pixels[j]),weight=(customWeight?customWeight(d2):50*Math.exp(-beta*d2))/length;
      if(a>=0&&b>=0)graph.edge(a,b,weight,weight);
      else{const node=a>=0?a:b,label=a>=0?fixed[j]:fixed[i];if(label===1)bg[node]+=weight;else fg[node]+=weight;}
    }
  }
  for(let i=0;i<free;i++){const offset=Math.min(fg[i],bg[i]);graph.edge(source,i,Math.max(0,bg[i]-offset));graph.edge(i,sink,Math.max(0,fg[i]-offset));}
  const reach=graph.reachable(source,sink);for(let i=0;i<n;i++)if(index[i]>=0)out[i]=reach[index[i]];return out;
}
