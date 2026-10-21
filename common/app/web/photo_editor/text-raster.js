// PhotoCraft text/src/raster.rs. Coverage is exact signed-area accumulation.
export function applyXform(xf,x,y){const [a,b,c,d,e,f]=xf;return [a*x+c*y+e,b*x+d*y+f];}
export class Coverage{
  constructor(width,height){this.width=width;this.height=height;this.acc=new Float32Array(width*height+2);}
  line(p0,p1){
    const w=this.width,h=this.height;
    if(p0[1]===p1[1]||![p0[0],p0[1],p1[0],p1[1]].every(Number.isFinite))return;
    let dir=1,x0=p0[0],y0=p0[1],x1=p1[0],y1=p1[1];
    if(p0[1]>p1[1]){dir=-1;x0=p1[0];y0=p1[1];x1=p0[0];y1=p0[1];}
    if(![x0,y0,x1,y1].every(Number.isFinite)||y1<=0||y0>=h)return;
    const dxdy=(x1-x0)/(y1-y0);
    let x=x0,y=Math.max(y0,0);
    if(y0<0)x-=y0*dxdy;
    const ye=Math.min(y1,h),stride=this.width;
    let row=Math.floor(y);
    while(y<ye){
      const ynext=Math.min(row+1,ye),dy=ynext-y,xnext=x+dxdy*dy,d=dy*dir;
      let xa=Math.min(x,xnext),xb=Math.max(x,xnext);
      xa=Math.max(0,Math.min(w,xa));xb=Math.max(0,Math.min(w,xb));
      const ls=row*stride,x0f=Math.floor(xa),x0i=x0f,x1c=Math.ceil(xb),x1i=x1c;
      if(x1i<=x0i+1){const xmf=.5*(xa+xb)-x0f;this.acc[ls+x0i]+=d-d*xmf;this.acc[ls+x0i+1]+=d*xmf;}
      else{const s=1/(xb-xa),x0frac=xa-x0f,a0=.5*s*(1-x0frac)*(1-x0frac),x1frac=xb-x1c+1,am=.5*s*x1frac*x1frac;this.acc[ls+x0i]+=d*a0;if(x1i===x0i+2)this.acc[ls+x0i+1]+=d*(1-a0-am);else{const a1=s*(1.5-x0frac);this.acc[ls+x0i+1]+=d*(a1-a0);for(let xi=x0i+2;xi<x1i-1;xi++)this.acc[ls+xi]+=d*s;const a2=a1+(x1i-x0i-3)*s;this.acc[ls+x1i-1]+=d*(1-a2-am);}this.acc[ls+x1i]+=d*am;}
      x=xnext;y=ynext;row++;
    }
  }
  finish(){const n=this.width*this.height,out=new Float32Array(n);let sum=0;for(let i=0;i<n;i++){sum+=this.acc[i];out[i]=Math.min(1,Math.abs(sum));}return out;}
}
export function rectTo(coverage,xf,x0,y0,x1,y1){const p=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>applyXform(xf,x,y));for(let i=0;i<4;i++)coverage.line(p[i],p[(i+1)%4]);}
export class Pen{
  constructor(coverage,xf){this.coverage=coverage;this.xf=xf;this.start=[0,0];this.last=[0,0];this.tol=.03;}
  to(p){this.coverage.line(this.last,p);this.last=p;}
  segments(a,b,c){const dd=Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1]);return Math.max(1,Math.min(100,Math.ceil(Math.sqrt(.75*dd/this.tol))));}
  moveTo(x,y){this.close();const p=applyXform(this.xf,x,y);this.start=p;this.last=p;}
  lineTo(x,y){this.to(applyXform(this.xf,x,y));}
  quadTo(cx,cy,x,y){const a=this.last,b=applyXform(this.xf,cx,cy),c=applyXform(this.xf,x,y),n=this.segments(a,b,c);for(let i=1;i<=n;i++){const t=i/n,mt=1-t;this.to([mt*mt*a[0]+2*mt*t*b[0]+t*t*c[0],mt*mt*a[1]+2*mt*t*b[1]+t*t*c[1]]);}}
  curveTo(c0x,c0y,c1x,c1y,x,y){const a=this.last,b=applyXform(this.xf,c0x,c0y),c=applyXform(this.xf,c1x,c1y),d=applyXform(this.xf,x,y),n=Math.max(this.segments(a,b,c),this.segments(b,c,d));for(let i=1;i<=n;i++){const t=i/n,mt=1-t,k0=mt*mt*mt,k1=3*mt*mt*t,k2=3*mt*t*t,k3=t*t*t;this.to([k0*a[0]+k1*b[0]+k2*c[0]+k3*d[0],k0*a[1]+k1*b[1]+k2*c[1]+k3*d[1]]);}}
  close(){if(this.last[0]!==this.start[0]||this.last[1]!==this.start[1])this.to(this.start);}
}
