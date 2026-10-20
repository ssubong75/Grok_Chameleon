// PhotoCraft panorama::photometric: log-space gains and shared vignette a·r² + b·r⁴.

function solveDense(n,a,b){
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

class Normal{
  constructor(n){this.n=n;this.ata=Array(n*n).fill(0);this.atb=Array(n).fill(0);}
  add(row,rhs,w){const w2=w*w;for(const [i,a] of row){this.atb[i]+=w2*a*rhs;for(const [j,b] of row)this.ata[i*this.n+j]+=w2*a*b;}}
  solve(){return solveDense(this.n,this.ata,this.atb);}
}

export function photometric(images,geometry,gain,vignette){
  vignette=vignette&&Boolean(geometry);
  const n=images.length,ch=images[0]?.ch||1;
  const identity={gains:images.map(()=>Array(ch).fill(1)),vignette:[0,0]};
  if(!n||(!gain&&!vignette))return identity;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const im of images){x0=Math.min(x0,im.x0);y0=Math.min(y0,im.y0);x1=Math.max(x1,im.x0+im.w);y1=Math.max(y1,im.y0+im.h);}
  const step=Math.ceil(Math.sqrt(Math.max(1,(x1-x0)*(y1-y0)/40000)));
  const r2of=(i,u,v)=>{
    if(!geometry)return 0;
    const [sx,sy]=geometry.inverse(i,u+.5,v+.5);
    if(sx==null)return null;
    const w=geometry.sizes[i][0],h=geometry.sizes[i][1],dx=sx-w/2,dy=sy-h/2;
    return (dx*dx+dy*dy)/(w*w/4+h*h/4);
  };
  const samples=[];
  for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){
    const cover=[];
    images.forEach((im,i)=>{const lx=x-im.x0,ly=y-im.y0;if(lx<0||ly<0||lx>=im.w||ly>=im.h)return;const k=ly*im.w+lx;if(im.alpha[k]>0.999)cover.push([i,k]);});
    for(let p=0;p<cover.length;p++)for(let q=p+1;q<cover.length;q++){
      const [a,ka]=cover[p],[b,kb]=cover[q];
      const ca=[...images[a].px.subarray(ka*ch,(ka+1)*ch)],cb=[...images[b].px.subarray(kb*ch,(kb+1)*ch)];
      if(ca.some(v=>v<0.02||v>0.98)||cb.some(v=>v<0.02||v>0.98))continue;
      if(ca.some((v,i)=>Math.abs(Math.log(v/cb[i]))>1))continue;
      const ra=r2of(a,x,y),rb=r2of(b,x,y);if(ra==null||rb==null)continue;
      samples.push([a,b,ca,cb,ra,rb]);
    }
  }
  if(samples.length<20)return identity;
  const sigmaN=0.05,sigmaG=gain?0.15:1e-4,nv=vignette?2:0;
  const out={gains:identity.gains.map(row=>row.slice()),vignette:[0,0]};
  const mean=new Normal(n+nv);
  for(const [a,b,ca,cb,ra,rb] of samples){
    const la=ca.reduce((s,v)=>s+Math.log(v),0)/ch,lb=cb.reduce((s,v)=>s+Math.log(v),0)/ch;
    const row=[[a,1],[b,-1]];
    if(vignette)row.push([n,ra-rb],[n+1,ra*ra-rb*rb]);
    mean.add(row,la-lb,1/sigmaN);
  }
  for(let i=0;i<n;i++)mean.add([[i,1]],0,1/sigmaG);
  if(vignette){mean.add([[n,1]],0,0.5);mean.add([[n+1,1]],0,0.5);}
  const sol=mean.solve();if(!sol)return out;
  if(vignette)out.vignette=[Math.max(-2,Math.min(0.5,sol[n])),Math.max(-2,Math.min(2,sol[n+1]))];
  if(gain)for(let c=0;c<ch;c++){
    const ne=new Normal(n);
    for(const [a,b,ca,cb,ra,rb] of samples){
      const va=out.vignette[0]*ra+out.vignette[1]*ra*ra,vb=out.vignette[0]*rb+out.vignette[1]*rb*rb;
      ne.add([[a,1],[b,-1]],(Math.log(ca[c])-va)-(Math.log(cb[c])-vb),1/sigmaN);
    }
    for(let i=0;i<n;i++)ne.add([[i,1]],0,1/sigmaG);
    const g=ne.solve();
    if(g)for(let i=0;i<n;i++)out.gains[i][c]=Math.max(0.2,Math.min(5,Math.exp(g[i])));
  }
  return out;
}

export function photometricFactor(photo,i,c,r2){
  const v=Math.exp(photo.vignette[0]*r2+photo.vignette[1]*r2*r2);
  return 1/(photo.gains[i][c]*v);
}
