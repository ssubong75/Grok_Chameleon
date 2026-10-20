// PhotoCraft magnetic selection algorithm, adapted to Canvas/JavaScript.
// Edge weights, strongest premultiplied-channel Sobel features and subpixel
// ridge locations follow crates/algo/src/magnetic.rs. See ATTRIBUTION.md.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const distance=(p,a,b)=>{const x=b.x-a.x,y=b.y-a.y,t=clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1),0,1);return (p.x-a.x-t*x)**2+(p.y-a.y-t*y)**2;};
class Heap{
  items=[];
  push(value){const a=this.items;let i=a.length;a.push(value);while(i){const p=(i-1)>>1;if(a[p][0]<=value[0])break;a[i]=a[p];i=p;}a[i]=value;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=last[0])break;a[i]=a[j];i=j;}a[i]=last;}return first;}
}
export function magneticSpacing(frequency,zoom){const f=Number.isFinite(frequency)?Math.max(0,Math.min(100,frequency)):57;return (8+(100-f)*.9)/Math.max(.01,zoom);}
export class MagneticLasso{
  constructor(canvas,{width=10,contrast=.1}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.width=clamp(width,1,256);this.contrast=clamp(contrast,.01,1);this.blocks=new Map();}
  clamp(p){return{x:clamp(p.x,0,this.canvas.width-.001),y:clamp(p.y,0,this.canvas.height-.001)};}
  field(p){const x=clamp(Math.floor(p.x),0,this.canvas.width-1),y=clamp(Math.floor(p.y),0,this.canvas.height-1),bx=Math.floor(x/128)*128,by=Math.floor(y/128)*128,key=bx+','+by;let block=this.blocks.get(key);if(!block){if(this.blocks.size>=1024)this.blocks.clear();block=this.makeBlock(bx,by);this.blocks.set(key,block);}const i=((y-by)*block.w+x-bx)*6;return block.data.subarray(i,i+6);}
  makeBlock(bx,by){const w=Math.min(128,this.canvas.width-bx),h=Math.min(128,this.canvas.height-by),x0=Math.max(0,bx-2),y0=Math.max(0,by-2),x1=Math.min(this.canvas.width,bx+w+2),y1=Math.min(this.canvas.height,by+h+2),ew=x1-x0,px=this.ctx.getImageData(x0,y0,ew,y1-y0).data;
    const at=(x,y,c)=>{const i=(clamp(y,y0,y1-1)-y0)*ew*4+(clamp(x,x0,x1-1)-x0)*4;return c===3?px[i+3]/255:px[i+c]*px[i+3]/65025;};
    const gw=w+2,st=new Float32Array(gw*(h+2)),gx=new Float32Array(st.length),gy=new Float32Array(st.length);
    for(let y=-1;y<=h;y++)for(let x=-1;x<=w;x++){let best=0,dx=0,dy=0;for(let c=0;c<4;c++){const xx=bx+x,yy=by+y,fx=at(xx+1,yy-1,c)+2*at(xx+1,yy,c)+at(xx+1,yy+1,c)-at(xx-1,yy-1,c)-2*at(xx-1,yy,c)-at(xx-1,yy+1,c),fy=at(xx-1,yy+1,c)+2*at(xx,yy+1,c)+at(xx+1,yy+1,c)-at(xx-1,yy-1,c)-2*at(xx,yy-1,c)-at(xx+1,yy-1,c),m=fx*fx+fy*fy;if(m>best){best=m;dx=fx;dy=fy;}}const i=(y+1)*gw+x+1,m=Math.sqrt(best);st[i]=Math.min(1,m/4);if(m>1e-6){gx[i]=dx/m;gy[i]=dy/m;}}
    const data=new Float32Array(w*h*6);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y+1)*gw+x+1,j=(y*w+x)*6,s=st[i],dx=Math.abs(gx[i])>=.4142*Math.abs(gy[i])?Math.sign(gx[i]):0,dy=Math.abs(gy[i])>=.4142*Math.abs(gx[i])?Math.sign(gy[i]):0,sm=st[i-dy*gw-dx],sp=st[i+dy*gw+dx],ridge=s>0&&s>=sm&&s>=sp,den=sm-2*s+sp,t=ridge&&den< -1e-6?clamp(.5*(sm-sp)/den,-.5,.5):0;data.set([s,gx[i],gy[i],ridge?1:0,t*dx,t*dy],j);}return{w,data};
  }
  snap(point){const p=this.clamp(point),r=this.width;let best=-1,result=p;for(let y=Math.max(0,Math.floor(p.y-r));y<Math.min(this.canvas.height,Math.ceil(p.y+r));y++)for(let x=Math.max(0,Math.floor(p.x-r));x<Math.min(this.canvas.width,Math.ceil(p.x+r));x++){const d=Math.hypot(x+.5-p.x,y+.5-p.y);if(d>r)continue;const f=this.field({x,y}),score=f[0]*(1-.25*d/r);if(f[0]>=this.contrast&&f[3]&&score>best){best=score;result={x:x+.5+f[4],y:y+.5+f[5]};}}return result;}
  trace(a,b){a=this.clamp(a);b=this.clamp(b);const length=Math.hypot(b.x-a.x,b.y-a.y);if(length>256){const points=[a],count=Math.ceil(length/256);for(let i=1;i<=count;i++){const target=i===count?b:({x:a.x+(b.x-a.x)*i/count,y:a.y+(b.y-a.y)*i/count});points.push(...this.trace(points.at(-1),target).slice(1));}return points;}
    const r=this.width+1.5,x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-r-1)),y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-r-1)),x1=Math.min(this.canvas.width,Math.ceil(Math.max(a.x,b.x)+r+1)),y1=Math.min(this.canvas.height,Math.ceil(Math.max(a.y,b.y)+r+1)),w=x1-x0,h=y1-y0,n=w*h,node=new Float32Array(n),tx=new Float32Array(n),ty=new Float32Array(n),cost=new Float64Array(n),parent=new Int32Array(n);cost.fill(Infinity);parent.fill(-1);node.fill(Infinity);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p={x:x+x0+.5,y:y+y0+.5},d=distance(p,a,b);if(d>r*r)continue;const f=this.field(p),i=y*w+x,good=clamp((f[0]-this.contrast)/Math.max(.02,this.contrast),0,1)*(.6+.4*Math.min(1,f[0]));node[i]=.43*(f[0]>=this.contrast&&f[3]?0:1)+.43*(1-good)+.02+.4*Math.min(1,Math.sqrt(d/(r*r)));if(f[0]>=.5*this.contrast){tx[i]=f[2];ty[i]=-f[1];}}
    const start=(Math.floor(a.y)-y0)*w+Math.floor(a.x)-x0,goal=(Math.floor(b.y)-y0)*w+Math.floor(b.x)-x0;node[start]=node[goal]=.45;cost[start]=0;const heap=new Heap();heap.push([0,start]);while(heap.items.length){const [value,i]=heap.pop();if(value>cost[i])continue;if(i===goal)break;const x=i%w,y=Math.floor(i/w);for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const j=yy*w+xx;if(!Number.isFinite(node[j]))continue;const len=dx&&dy?Math.SQRT2:1;let direction=2/3;if((tx[i]||ty[i])&&(tx[j]||ty[j])){let lx=dx/len,ly=dy/len;if(tx[i]*lx+ty[i]*ly<0){lx=-lx;ly=-ly;}direction=2/(3*Math.PI)*(Math.acos(clamp(tx[i]*lx+ty[i]*ly,-1,1))+Math.acos(clamp(tx[j]*lx+ty[j]*ly,-1,1)));}const next=value+node[j]*len+.14*direction;if(next<cost[j]){cost[j]=next;parent[j]=i;heap.push([next,j]);}}}
    if(!Number.isFinite(cost[goal]))return[a,b];const points=[];for(let i=goal;i!==-1;i=parent[i]){const p={x:x0+i%w+.5,y:y0+Math.floor(i/w)+.5},f=this.field(p);if(f[0]>=this.contrast&&f[3]){p.x+=f[4];p.y+=f[5];}points.push(p);if(i===start)break;}points.reverse();points[0]=a;points[points.length-1]=b;return points;
  }
}
