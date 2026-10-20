// PhotoCraft crates/algo/src/features.rs: Harris corners, steered BRIEF, Hamming match, RANSAC.

const PATCH_RADIUS=15;
const NIBBLE=Uint8Array.from({length:16},(_,i)=>((i&1)+(i>>1&1)+(i>>2&1)+(i>>3&1)));

class Rng{
  constructor(seed){this.state=BigInt(seed);}
  next(){this.state=(this.state+0x9E3779B97F4A7C15n)&0xFFFFFFFFFFFFFFFFn;let z=this.state;z=(z^(z>>30n))*0xBF58476D1CE4E5B9n&0xFFFFFFFFFFFFFFFFn;z=(z^(z>>27n))*0x94D049BB133111EBn&0xFFFFFFFFFFFFFFFFn;return z^(z>>31n);}
  unit(){return Number(this.next()>>11n)/Number(1n<<53n);}
  below(n){return Number(this.next()%BigInt(Math.max(1,n)));}
}

function popcount(n){let c=0,x=n;for(let i=0;i<16;i++){c+=NIBBLE[Number(x&15n)];x>>=4n;}return c;}

function blur(w,h,v,r){
  const pass=(src,horizontal)=>{
    const dst=new Float32Array(src.length),n=horizontal?h:w,m=horizontal?w:h;
    const at=(line,k)=>{k=Math.max(0,Math.min(m-1,k));return horizontal?src[line*w+k]:src[k*w+line];};
    for(let line=0;line<n;line++){let acc=0;for(let k=-r;k<=r;k++)acc+=at(line,k);for(let k=0;k<m;k++){const i=horizontal?line*w+k:k*w+line;dst[i]=acc/(2*r+1);acc+=at(line,k+r+1)-at(line,k-r);}}
    return dst;
  };
  return pass(pass(v,true),false);
}

export function harris(w,h,img,max,minDist,valid){
  if(w<2*PATCH_RADIUS+3||h<2*PATCH_RADIUS+3)return [];
  const xx=new Float32Array(w*h),yy=new Float32Array(w*h),xy=new Float32Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const p=(dx,dy)=>img[(y+dy)*w+x+dx];
    const gx=(p(1,-1)+2*p(1,0)+p(1,1))-(p(-1,-1)+2*p(-1,0)+p(-1,1));
    const gy=(p(-1,1)+2*p(0,1)+p(1,1))-(p(-1,-1)+2*p(0,-1)+p(1,-1));
    const i=y*w+x;xx[i]=gx*gx;yy[i]=gy*gy;xy[i]=gx*gy;
  }
  const sxx=blur(w,h,blur(w,h,xx,1),1),syy=blur(w,h,blur(w,h,yy,1),1),sxy=blur(w,h,blur(w,h,xy,1),1);
  const r=new Float32Array(w*h);let peak=0;
  for(let i=0;i<r.length;i++){r[i]=sxx[i]*syy[i]-sxy[i]*sxy[i]-0.04*(sxx[i]+syy[i])**2;if(r[i]>peak)peak=r[i];}
  if(peak<=0)return [];
  const m=PATCH_RADIUS+1,cand=[];
  for(let y=m;y<h-m;y++)for(let x=m;x<w-m;x++){
    const v=r[y*w+x];if(v<peak*0.01)continue;
    let isMax=true;
    for(let dy=-1;dy<=1&&isMax;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&r[(y+dy)*w+x+dx]>v)isMax=false;
    if(!isMax)continue;
    if(valid){let all=true;for(let yy=y-PATCH_RADIUS;yy<=y+PATCH_RADIUS&&all;yy+=5)for(let xx=x-PATCH_RADIUS;xx<=x+PATCH_RADIUS;xx+=5)if(!valid[yy*w+xx])all=false;if(!all)continue;}
    cand.push({x,y,score:v});
  }
  cand.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
  const cell=Math.max(1,minDist),gw=Math.ceil(w/cell)+1,gh=Math.ceil(h/cell)+1,grid=Array.from({length:gw*gh},()=>[]);
  const out=[];
  for(const c of cand){
    const gx=Math.floor(c.x/cell),gy=Math.floor(c.y/cell);
    let near=false;
    for(let yy=Math.max(0,gy-1);yy<=Math.min(gh-1,gy+1)&&!near;yy++)for(let xx=Math.max(0,gx-1);xx<=Math.min(gw-1,gx+1);xx++)for(const p of grid[yy*gw+xx])if(Math.hypot(p[0]-c.x,p[1]-c.y)<minDist)near=true;
    if(near)continue;
    grid[gy*gw+gx].push([c.x,c.y]);out.push(c);if(out.length>=max)break;
  }
  return out;
}

const PAIRS=(()=>{
  const rng=new Rng(0x0B21EF00n);
  const gauss=()=>{const u=Math.max(1e-12,rng.unit()),v=rng.unit();return Math.max(-13,Math.min(13,Math.sqrt(-2*Math.log(u))*Math.cos(Math.PI*2*v)*31/5));};
  return Array.from({length:256},()=>[gauss(),gauss(),gauss(),gauss()]);
})();

function describe(w,h,img,corners,upright){
  const smooth=blur(w,h,img,2);
  const at=(x,y)=>smooth[Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x)))];
  return corners.map(c=>{
    let s=0,co=1;
    if(!upright){let m10=0,m01=0;const r=PATCH_RADIUS;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r){const v=at(c.x+dx,c.y+dy);m10+=dx*v;m01+=dy*v;}const th=Math.atan2(m01,m10);s=Math.sin(th);co=Math.cos(th);}
    const d=[0n,0n,0n,0n];
    PAIRS.forEach((p,i)=>{
      const rot=(x,y)=>[c.x+x*co-y*s,c.y+x*s+y*co];
      const a=rot(p[0],p[1]),b=rot(p[2],p[3]);
      if(at(a[0],a[1])<at(b[0],b[1]))d[i>>6]|=1n<<(BigInt(i&63));
    });
    return d;
  });
}

function hamming(a,b){return popcount(a[0]^b[0])+popcount(a[1]^b[1])+popcount(a[2]^b[2])+popcount(a[3]^b[3]);}

function matchDescriptors(a,b,ratio){
  const best=(d,set)=>{let first=[-1,1e9],second=1e9;set.forEach((e,j)=>{const h=hamming(d,e);if(h<first[1]){second=first[1];first=[j,h];}else if(h<second)second=h;});return first[0]<0?null:[first[0],first[1],second];};
  const out=[];
  a.forEach((d,i)=>{
    const hit=best(d,b);if(!hit)return;
    const [j,d1,d2]=hit;
    if(d1>80||(d2<1e9&&d1>ratio*d2))return;
    const back=best(b[j],a);if(back&&back[0]===i)out.push([i,j]);
  });
  return out;
}

export class Homography{
  constructor(m){this.m=m.slice();}
  apply(x,y){const m=this.m,w=m[6]*x+m[7]*y+m[8];return [(m[0]*x+m[1]*y+m[2])/w,(m[3]*x+m[4]*y+m[5])/w];}
  mul(o){const a=this.m,b=o.m,r=Array(9).fill(0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)r[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j];return new Homography(r);}
  inverse(){const m=this.m,c=[m[4]*m[8]-m[5]*m[7],m[2]*m[7]-m[1]*m[8],m[1]*m[5]-m[2]*m[4],m[5]*m[6]-m[3]*m[8],m[0]*m[8]-m[2]*m[6],m[2]*m[3]-m[0]*m[5],m[3]*m[7]-m[4]*m[6],m[1]*m[6]-m[0]*m[7],m[0]*m[4]-m[1]*m[3]];const det=m[0]*c[0]+m[1]*c[3]+m[2]*c[6];if(Math.abs(det)<1e-12)return null;return new Homography(c.map(v=>v/det));}
}

function solve(n,a,b){
  a=a.slice();b=b.slice();
  for(let c=0;c<n;c++){
    let p=c;for(let i=c+1;i<n;i++)if(Math.abs(a[i*n+c])>Math.abs(a[p*n+c]))p=i;
    if(Math.abs(a[p*n+c])<1e-12)return null;
    if(p!==c){for(let k=0;k<n;k++)[a[c*n+k],a[p*n+k]]=[a[p*n+k],a[c*n+k]];[b[c],b[p]]=[b[p],b[c]];}
    for(let r=c+1;r<n;r++){const f=a[r*n+c]/a[c*n+c];for(let k=c;k<n;k++)a[r*n+k]-=f*a[c*n+k];b[r]-=f*b[c];}
  }
  const x=Array(n).fill(0);
  for(let r=n-1;r>=0;r--){let s=0;for(let k=r+1;k<n;k++)s+=a[r*n+k]*x[k];x[r]=(b[r]-s)/a[r*n+r];}
  return x;
}

function leastSquares(rows,n){
  const ata=Array(n*n).fill(0),atb=Array(n).fill(0);
  for(const [r,b] of rows)for(let i=0;i<n;i++){atb[i]+=r[i]*b;for(let j=0;j<n;j++)ata[i*n+j]+=r[i]*r[j];}
  return solve(n,ata,atb);
}

function normaliser(pts){
  const n=Math.max(1,pts.length);let cx=0,cy=0;for(const p of pts){cx+=p[0];cy+=p[1];}cx/=n;cy/=n;
  let d=0;for(const p of pts)d+=Math.hypot(p[0]-cx,p[1]-cy);d/=n;
  const s=d>1e-12?Math.SQRT2/d:1;
  return new Homography([s,0,-s*cx,0,s,-s*cy,0,0,1]);
}

const MIN={translation:1,similarity:2,homography:4};

export function fit(model,src,dst){
  const n=src.length;
  if(model==='translation'){if(!n)return null;let tx=0,ty=0;src.forEach((s,i)=>{tx+=dst[i][0]-s[0];ty+=dst[i][1]-s[1];});return new Homography([1,0,tx/n,0,1,ty/n,0,0,1]);}
  if(model==='similarity'){if(n<2)return null;const rows=[];src.forEach((s,i)=>{rows.push([[s[0],-s[1],1,0],dst[i][0]],[[s[1],s[0],0,1],dst[i][1]]);});const v=leastSquares(rows,4);if(!v)return null;return new Homography([v[0],-v[1],v[2],v[1],v[0],v[3],0,0,1]);}
  if(n<4)return null;
  const ts=normaliser(src),td=normaliser(dst),rows=[];
  src.forEach((s,i)=>{const [x,y]=ts.apply(s[0],s[1]),[u,v]=td.apply(dst[i][0],dst[i][1]);rows.push([[x,y,1,0,0,0,-u*x,-u*y],u],[[0,0,0,x,y,1,-v*x,-v*y],v]);});
  const h=leastSquares(rows,8);if(!h)return null;
  const hn=new Homography([h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]);
  const inv=td.inverse();if(!inv)return null;
  const m=inv.mul(hn).mul(ts),k=m.m[8];if(Math.abs(k)<1e-12)return null;
  return new Homography(m.m.map(v=>v/k));
}

export function ransac(model,src,dst,iters,threshold,seed){
  const k=MIN[model],n=src.length;if(n<k)return null;
  const rng=new Rng(BigInt(seed)^0xA11C0DE5n);
  const inliersOf=h=>{const out=[];for(let i=0;i<n;i++){const [x,y]=h.apply(src[i][0],src[i][1]);if(Number.isFinite(x)&&Math.hypot(x-dst[i][0],y-dst[i][1])<=threshold)out.push(i);}return out;};
  let best=null;
  for(let t=0;t<Math.max(1,iters);t++){
    const idx=[];
    while(idx.length<k){if(n===k){idx.push(...Array.from({length:k},(_,i)=>i));break;}const i=rng.below(n);if(!idx.includes(i))idx.push(i);}
    const s=idx.map(i=>src[i]),d=idx.map(i=>dst[i]),h=fit(model,s,d);if(!h)continue;
    const inl=inliersOf(h);if(!best||inl.length>best[1].length)best=[h,inl];
  }
  if(!best||best[1].length<k)return null;
  const s=best[1].map(i=>src[i]),d=best[1].map(i=>dst[i]),h2=fit(model,s,d)||best[0],inl2=inliersOf(h2);
  return inl2.length>=best[1].length?[h2,inl2]:best;
}

export function register(w,h,reference,moving,validRef,validMov,model){
  const upright=model==='translation';
  const minDist=Math.max(4,Math.min(24,Math.max(w,h)/60));
  const ca=harris(w,h,reference,600,minDist,validRef),cb=harris(w,h,moving,600,minDist,validMov);
  if(ca.length<4||cb.length<4)return null;
  const da=describe(w,h,reference,ca,upright),db=describe(w,h,moving,cb,upright);
  const matches=matchDescriptors(db,da,0.85);
  const src=matches.map(([i])=>[cb[i].x,cb[i].y]),dst=matches.map(([,j])=>[ca[j].x,ca[j].y]);
  const threshold=Math.max(1.5,Math.min(4,Math.max(w,h)/400));
  const fit=ransac(model,src,dst,1000,threshold,7);
  const need=Math.max(MIN[model],6);
  return fit&&fit[1].length>=need?{homography:fit[0],inliers:fit[1].length,src:fit[1].map(i=>src[i]),dst:fit[1].map(i=>dst[i])}:null;
}

export function detectFeatures(w,h,luma,valid,max=800){
  const minDist=Math.max(3,Math.min(20,Math.max(w,h)/70));
  const corners=harris(w,h,luma,max,minDist,valid);
  return {w,h,points:corners.map(c=>[c.x,c.y]),desc:describe(w,h,luma,corners,false)};
}

export function matchFeaturePair(fa,fb){
  if(fa.points.length<6||fb.points.length<6)return null;
  const matches=matchDescriptors(fb.desc,fa.desc,0.8);
  if(matches.length<8)return null;
  const src=matches.map(([i])=>fb.points[i]),dst=matches.map(([,j])=>fa.points[j]);
  const threshold=Math.max(1.5,Math.min(4,Math.max(fa.w,fa.h)/300));
  const fit=ransac('homography',src,dst,1200,threshold,7);
  if(!fit||fit[1].length<10||fit[1].length<8+0.3*matches.length)return null;
  return {ptsA:fit[1].map(i=>dst[i]),ptsB:fit[1].map(i=>src[i]),homography:fit[0],inliers:fit[1].length};
}
