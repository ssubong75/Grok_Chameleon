export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const shade=(color,k)=>color.slice(0,3).map(v=>clamp(v*k,0,1)).concat(1);
export class RenderRng{
  constructor(seed,salt){this.state=BigInt.asUintN(64,(BigInt(seed>>>0)<<32n)^BigInt.asUintN(64,BigInt(salt)*0x9e3779b97f4a7c15n)^0x2545f4914f6cdd1dn);}
  nextU64(){this.state=BigInt.asUintN(64,this.state+0x9e3779b97f4a7c15n);let z=this.state;z=BigInt.asUintN(64,(z^(z>>30n))*0xbf58476d1ce4e5b9n);z=BigInt.asUintN(64,(z^(z>>27n))*0x94d049bb133111ebn);z^=z>>31n;return z;}
  f(){return Number(this.nextU64()>>40n)/16777216;}
  range(a,b){return a+(b-a)*this.f();}sym(){return this.f()*2-1;}
}
export const capsule=(a,b,ra,rb,c0,c1=c0)=>({type:'capsule',a,b,ra,rb,c0:[...c0],c1:[...c1],soft:1,blend:'normal'});
export const ellipse=(center,rx,ry,angle,c0,c1=c0)=>({type:'ellipse',center,rx,ry,angle,c0:[...c0],c1:[...c1],soft:1,blend:'normal'});
export const disc=(center,r,color)=>ellipse(center,r,r,0,color);
function bounds(p){const soft=Math.max(1,p.soft)+1;if(p.type==='capsule'){const r=Math.max(p.ra,p.rb)+soft;return[Math.floor(Math.min(p.a[0],p.b[0])-r),Math.floor(Math.min(p.a[1],p.b[1])-r),Math.ceil(Math.max(p.a[0],p.b[0])+r),Math.ceil(Math.max(p.a[1],p.b[1])+r)];}const s=Math.sin(p.angle),c=Math.cos(p.angle),ex=Math.hypot(p.rx*c,p.ry*s)+soft,ey=Math.hypot(p.rx*s,p.ry*c)+soft;return[Math.floor(p.center[0]-ex),Math.floor(p.center[1]-ey),Math.ceil(p.center[0]+ex),Math.ceil(p.center[1]+ey)];}
function evaluate(p,x,y){const soft=Math.max(1,p.soft);if(p.type==='capsule'){const dx=p.b[0]-p.a[0],dy=p.b[1]-p.a[1],l2=dx*dx+dy*dy,t=l2>1e-9?clamp(((x-p.a[0])*dx+(y-p.a[1])*dy)/l2,0,1):0,d=Math.hypot(p.a[0]+dx*t-x,p.a[1]+dy*t-y),r=p.ra+(p.rb-p.ra)*t;return[clamp((Math.max(r,.5)-d)/soft+.5,0,1)*clamp(2*r,0,1),t];}const s=Math.sin(p.angle),c=Math.cos(p.angle),dx=x-p.center[0],dy=y-p.center[1],u=dx*c+dy*s,v=-dx*s+dy*c,rx=Math.max(.05,p.rx),ry=Math.max(.05,p.ry),e=Math.hypot(u/rx,v/ry),edge=(1-e)*Math.min(rx,ry);return[clamp(edge/soft+.5,0,1)*clamp(2*Math.min(rx,ry),0,1),Math.min(1,e)];}
export function renderPrimitives(image,primitives,settings={}){
  const {width,height,data}=image,ox=Number(settings.x)||0,oy=Number(settings.y)||0,dw=Number(settings.documentWidth)||width,dh=Number(settings.documentHeight)||height,bins=new Map();
  for(const p of primitives){p.bounds=bounds(p);const [a,b,c,d]=p.bounds,x0=Math.max(0,Math.floor((a-ox)/128)),x1=Math.min(Math.ceil(width/128)-1,Math.floor((c-1-ox)/128)),y0=Math.max(0,Math.floor((b-oy)/128)),y1=Math.min(Math.ceil(height/128)-1,Math.floor((d-1-oy)/128));for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=y*Math.ceil(width/128)+x;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}}
  for(const [key,list]of bins){const tx=key%Math.ceil(width/128)*128,ty=Math.floor(key/Math.ceil(width/128))*128,tw=Math.min(128,width-tx),th=Math.min(128,height-ty),paint=new Float32Array(tw*th*4);
    for(const p of list){const [a,b,c,d]=p.bounds,x0=Math.max(tx,Math.ceil(a-ox),Math.ceil(-ox)),x1=Math.min(tx+tw,Math.ceil(c-ox),Math.ceil(dw-ox)),y0=Math.max(ty,Math.ceil(b-oy),Math.ceil(-oy)),y1=Math.min(ty+th,Math.ceil(d-oy),Math.ceil(dh-oy));for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const [coverage,t]=evaluate(p,ox+x+.5,oy+y+.5);if(coverage<=0)continue;const color=p.c0.map((v,i)=>v+(p.c1[i]-v)*t),alpha=clamp(color[3]*coverage,0,1),i=((y-ty)*tw+x-tx)*4;if(alpha<=0)continue;for(let c=0;c<3;c++)paint[i+c]=p.blend==='add'?paint[i+c]+color[c]*alpha:p.blend==='lighten'?Math.max(paint[i+c],color[c]*alpha):color[c]*alpha+paint[i+c]*(1-alpha);paint[i+3]=p.blend==='lighten'?Math.max(paint[i+3],alpha):alpha+paint[i+3]*(1-alpha);}}
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const i=(y*tw+x)*4,o=((ty+y)*width+tx+x)*4,sa=clamp(paint[i+3],0,1);if(sa<=0)continue;const inv=1/Math.max(1e-6,paint[i+3]),da=data[o+3]/255,oa=sa+da*(1-sa);for(let c=0;c<3;c++)data[o+c]=oa>1e-7?(clamp(paint[i+c]*inv,0,1)*sa+data[o+c]/255*da*(1-sa))/oa*255:0;data[o+3]=oa*255;}
  }
  return image;
}
