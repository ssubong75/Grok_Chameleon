const BERN_INV=[[1,0,0,0],[-5/6,3,-1.5,1/3],[1/3,-1.5,3,-5/6],[0,0,0,1]];
const bernstein=t=>{const s=1-t;return [s*s*s,3*s*s*t,3*s*t*t,t*t*t];};
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function splitCubic(p,t){const a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t),d=lerp(a,b,t),e=lerp(b,c,t),f=lerp(d,e,t);return [p[0],a,d,f,e,c,p[3]];}

export class BezierMesh{
  constructor(us,vs,points){this.us=us;this.vs=vs;this.points=points;}
  static identity(bounds,cols=1,rows=1){
    cols=Math.max(1,Math.min(64,cols));rows=Math.max(1,Math.min(64,rows));
    const us=Array.from({length:cols+1},(_,i)=>i/cols),vs=Array.from({length:rows+1},(_,i)=>i/rows);
    return BezierMesh.fit((s,t)=>[bounds[0]+s*(bounds[2]-bounds[0]),bounds[1]+t*(bounds[3]-bounds[1])],us,vs);
  }
  static fit(f,us,vs){
    const pc=us.length-1,pr=vs.length-1,nx=3*pc+1,points=Array.from({length:nx*(3*pr+1)},()=>[0,0]);
    for(let pj=0;pj<pr;pj++)for(let pi=0;pi<pc;pi++){
      const s=Array.from({length:4},()=>Array.from({length:4},()=>[0,0]));
      for(let j=0;j<4;j++)for(let i=0;i<4;i++){const u=us[pi]+(us[pi+1]-us[pi])*i/3,t=vs[pj]+(vs[pj+1]-vs[pj])*j/3;s[j][i]=f(u,t);}
      for(let j=0;j<4;j++)for(let i=0;i<4;i++){const acc=[0,0];for(let a=0;a<4;a++)for(let b=0;b<4;b++){const k=BERN_INV[j][a]*BERN_INV[i][b];acc[0]+=k*s[a][b][0];acc[1]+=k*s[a][b][1];}points[(3*pj+j)*nx+3*pi+i]=acc;}
    }
    return new BezierMesh(us.slice(),vs.slice(),points);
  }
  nx(){return 3*(this.us.length-1)+1;}
  ny(){return 3*(this.vs.length-1)+1;}
  locate(knots,s){const n=knots.length-1;s=Math.max(0,Math.min(1,s));let i=0;while(i+1<n&&s>knots[i+1])i++;const w=knots[i+1]-knots[i];return [i,w>0?(s-knots[i])/w:0];}
  eval(s,t){
    const [pi,a]=this.locate(this.us,s),[pj,b]=this.locate(this.vs,t),ba=bernstein(a),bb=bernstein(b),nx=this.nx();const out=[0,0];
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){const p=this.points[(3*pj+j)*nx+3*pi+i],k=ba[i]*bb[j];out[0]+=p[0]*k;out[1]+=p[1]*k;}
    return out;
  }
  splitU(s){
    const [pi,a]=this.locate(this.us,s);if(a<0.01||a>0.99)return false;
    const nx=this.nx(),ny=this.ny(),pts=[];
    for(let j=0;j<ny;j++){const row=this.points.slice(j*nx,(j+1)*nx);pts.push(...row.slice(0,3*pi),...splitCubic([row[3*pi],row[3*pi+1],row[3*pi+2],row[3*pi+3]],a),...row.slice(3*pi+4));}
    this.points=pts;this.us.splice(pi+1,0,Math.max(0,Math.min(1,s)));return true;
  }
  splitV(t){this.transpose();const ok=this.splitU(t);this.transpose();return ok;}
  removeSplitU(k){
    if(k<=0||k+1>=this.us.length)return false;
    const a=(this.us[k]-this.us[k-1])/(this.us[k+1]-this.us[k-1]),nx=this.nx(),ny=this.ny(),c0=3*(k-1),pts=[];
    for(let j=0;j<ny;j++){
      const row=this.points.slice(j*nx,(j+1)*nx),p0=row[c0],q1=row[c0+1],r2=row[c0+5],p3=row[c0+6];
      const p1=[(q1[0]-(1-a)*p0[0])/a,(q1[1]-(1-a)*p0[1])/a],p2=[(r2[0]-a*p3[0])/(1-a),(r2[1]-a*p3[1])/(1-a)];
      pts.push(...row.slice(0,c0),p0,p1,p2,p3,...row.slice(c0+7));
    }
    this.points=pts;this.us.splice(k,1);return true;
  }
  removeSplitV(k){this.transpose();const ok=this.removeSplitU(k);this.transpose();return ok;}
  transpose(){
    const nx=this.nx(),ny=this.ny(),pts=Array.from({length:nx*ny},()=>[0,0]);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)pts[i*ny+j]=this.points[j*nx+i];
    this.points=pts;[this.us,this.vs]=[this.vs,this.us];
  }
  paramAt(p){
    const n=24;let best=[.5,.5,Infinity];
    for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const s=i/n,t=j/n,q=this.eval(s,t),d=(q[0]-p[0])**2+(q[1]-p[1])**2;if(d<best[2])best=[s,t,d];}
    let s=best[0],t=best[1];
    for(let step=0;step<8;step++){
      const h=1e-4,q=this.eval(s,t),qs=this.eval(s+h,t),qt=this.eval(s,t+h),a=(qs[0]-q[0])/h,b=(qt[0]-q[0])/h,c=(qs[1]-q[1])/h,d=(qt[1]-q[1])/h,det=a*d-b*c;
      if(Math.abs(det)<1e-12)break;const ex=p[0]-q[0],ey=p[1]-q[1];
      s=Math.max(0,Math.min(1,s+(d*ex-b*ey)/det));t=Math.max(0,Math.min(1,t+(a*ey-c*ex)/det));
    }
    return [s,t];
  }
  pull(base,s,t,d){
    if(base.length!==this.points.length||!Number.isFinite(d[0])||!Number.isFinite(d[1]))return;
    this.points=base.map(p=>p.slice());
    const cols=this.us.length-1,rows=this.vs.length-1,[pi,a]=this.locate(this.us,s),[pj,b]=this.locate(this.vs,t),ba=bernstein(a),bb=bernstein(b),nx=this.nx();
    const anchor=(ai,aj)=>base[3*aj*nx+3*ai]?.slice()||[0,0];
    const at0=this.eval(s,t),target=[at0[0]+d[0],at0[1]+d[1]];
    let size=1;for(let k=0;k<2;k++){const vals=[anchor(pi,pj),anchor(pi+1,pj),anchor(pi,pj+1),anchor(pi+1,pj+1)].map(p=>p[k]);size=Math.max(size,Math.max(...vals)-Math.min(...vals));}
    const radius=1.8*size,innerW=(ba[1]+ba[2])*(bb[1]+bb[2]),interior=Math.max(0,Math.min(1,innerW/0.5625)),toBorder=Math.min(s,1-s,t,1-t),nearBorder=Math.max(0,Math.min(1,1-toBorder/0.12));
    const meshCorner=(ai,aj)=>(ai===0||ai===cols)&&(aj===0||aj===rows);
    const reach=(ai,aj,wa,wb)=>{const border=ai===0||ai===cols||aj===0||aj===rows;return meshCorner(ai,aj)?0:wa*wb*(border?nearBorder:1);};
    const corner=[[pi,pj,reach(pi,pj,ba[0]+ba[1],bb[0]+bb[1])],[pi+1,pj,reach(pi+1,pj,ba[2]+ba[3],bb[0]+bb[1])],[pi,pj+1,reach(pi,pj+1,ba[0]+ba[1],bb[2]+bb[3])],[pi+1,pj+1,reach(pi+1,pj+1,ba[2]+ba[3],bb[2]+bb[3])]];
    const share=Array.from({length:(cols+1)*(rows+1)},()=>0);
    for(let aj=0;aj<=rows;aj++)for(let ai=0;ai<=cols;ai++){const p=anchor(ai,aj),x=Math.max(0,Math.min(1,Math.hypot(p[0]-at0[0],p[1]-at0[1])/radius)),fall=.5*(1+Math.cos(Math.PI*x)),border=ai===0||ai===cols||aj===0||aj===rows,edge=meshCorner(ai,aj)?0:border?nearBorder:1;share[aj*(cols+1)+ai]=fall*edge;}
    for(const [ai,aj,w] of corner){const i=aj*(cols+1)+ai;share[i]=Math.max(share[i],(1-interior)*w);}
    for(let j=0;j<this.ny();j++)for(let i=0;i<nx;i++){const ai=Math.min(cols,(i+1)/3|0),aj=Math.min(rows,(j+1)/3|0),k=share[aj*(cols+1)+ai],p=this.points[j*nx+i];p[0]+=d[0]*k;p[1]+=d[1]*k;}
    let norm=0;for(const j of [1,2])for(const i of [1,2])norm+=(ba[i]*bb[j])**2;
    let cornerNorm=0;for(const c of corner)cornerNorm+=c[2]*c[2];
    const innerPart=cornerNorm>1e-12?Math.min(1,innerW/0.15):1;
    const edge=[];
    for(const k of [1,2]){
      if(pi===0)edge.push([(3*pj+k)*nx+3*pi,ba[0]*bb[k]]);
      if(pi+1===cols)edge.push([(3*pj+k)*nx+3*pi+3,ba[3]*bb[k]]);
      if(pj===0)edge.push([3*pj*nx+3*pi+k,ba[k]*bb[0]]);
      if(pj+1===rows)edge.push([(3*pj+3)*nx+3*pi+k,ba[k]*bb[3]]);
    }
    let edgeNorm=0;for(const e of edge)edgeNorm+=e[1]*e[1];
    const edgePart=edgeNorm>1e-12?nearBorder:0,innerShare=(1-edgePart)*innerPart,cornerShare=(1-edgePart)*(1-innerPart);
    for(let n=0;n<60;n++){
      const now=this.eval(s,t),rem=[target[0]-now[0],target[1]-now[1]];
      if(Math.hypot(rem[0],rem[1])<1e-9)break;
      if(innerShare>0&&norm>0)for(const j of [1,2])for(const i of [1,2]){const k=ba[i]*bb[j]/norm*innerShare,p=this.points[(3*pj+j)*nx+3*pi+i];p[0]+=rem[0]*k;p[1]+=rem[1]*k;}
      if(edgePart>0)for(const [idx,w] of edge){const p=this.points[idx];if(!p)continue;const k=w/edgeNorm*edgePart;p[0]+=rem[0]*k;p[1]+=rem[1]*k;}
      if(cornerShare>0&&cornerNorm>0)for(const [ai,aj,w] of corner){const k=w/cornerNorm*cornerShare;for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const i=3*ai+di,j=3*aj+dj;if(i>=0&&j>=0&&i<nx&&j<this.ny()){const p=this.points[j*nx+i];p[0]+=rem[0]*k;p[1]+=rem[1]*k;}}}
      for(let m=0;m<3;m++)this.smoothLines(Math.max(0,3*pi-3),3*pi+7,Math.max(0,3*pj-3),3*pj+7);
    }
  }
  smoothLines(i0,i1,j0,j1){
    const nx=this.nx();i1=Math.min(i1,nx);j1=Math.min(j1,this.ny());const triples=[];
    for(let a=1;a<this.us.length-1;a++)if(3*a>=i0&&3*a<i1)for(let j=j0;j<j1;j++)triples.push([j*nx+3*a-1,j*nx+3*a,j*nx+3*a+1,this.us[a]-this.us[a-1],this.us[a+1]-this.us[a]]);
    for(let b=1;b<this.vs.length-1;b++)if(3*b>=j0&&3*b<j1)for(let i=i0;i<i1;i++)triples.push([(3*b-1)*nx+i,3*b*nx+i,(3*b+1)*nx+i,this.vs[b]-this.vs[b-1],this.vs[b+1]-this.vs[b]]);
    for(const [l,c,r,hl,hr] of triples){const pl=this.points[l],pc=this.points[c],pr=this.points[r],tan=[((pc[0]-pl[0])/hl+(pr[0]-pc[0])/hr)/2,((pc[1]-pl[1])/hl+(pr[1]-pc[1])/hr)/2];this.points[l]=[pc[0]-tan[0]*hl,pc[1]-tan[1]*hl];this.points[r]=[pc[0]+tan[0]*hr,pc[1]+tan[1]*hr];}
  }
  dragPoint(base,index,d){
    if(base.length!==this.points.length||index>=base.length||!Number.isFinite(d[0])||!Number.isFinite(d[1]))return;
    this.points=base.map(p=>p.slice());
    const nx=this.nx(),ny=this.ny(),i=index%nx,j=index/nx|0;
    const shift=(x,y,delta)=>{if(x>=0&&y>=0&&x<nx&&y<ny){const p=this.points[y*nx+x];p[0]+=delta[0];p[1]+=delta[1];}};
    const span=(knots,k)=>k>0&&k+1<knots.length?[knots[k]-knots[k-1],knots[k+1]-knots[k]]:null;
    const r=i%3,q=j%3;
    if(r===0&&q===0){for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++)shift(i+di,j+dj,d);return;}
    if(r===0){for(let di=-1;di<=1;di++)shift(i+di,j,d);const sp=span(this.vs,j/3+(q===2?1:0)|0);if(sp){const other=q===1?j-2:j+2,k=q===1?sp[0]/sp[1]:sp[1]/sp[0];for(let di=-1;di<=1;di++)shift(i+di,other,[-d[0]*k,-d[1]*k]);}return;}
    if(q===0){for(let dj=-1;dj<=1;dj++)shift(i,j+dj,d);const sp=span(this.us,i/3+(r===2?1:0)|0);if(sp){const other=r===1?i-2:i+2,k=r===1?sp[0]/sp[1]:sp[1]/sp[0];for(let dj=-1;dj<=1;dj++)shift(other,j+dj,[-d[0]*k,-d[1]*k]);}return;}
    shift(i,j,d);
  }
}

function commitDefaultSections(mesh){mesh.splitU(1/3);mesh.splitU(2/3);mesh.splitV(1/3);mesh.splitV(2/3);}
function mid(knots,v){let i=0;while(i+1<knots.length-1&&v>knots[i+1])i++;return (knots[i]+knots[i+1])/2;}
function nearest(knots,v){let best=-1,dist=Infinity;for(let i=1;i<knots.length-1;i++){const d=Math.abs(knots[i]-v);if(d<dist){dist=d;best=i;}}return [best,dist];}

export function splitMesh(mesh,how,at=null){
  if(how!=='remove'&&mesh.us.length===2&&mesh.vs.length===2)commitDefaultSections(mesh);
  let s=.5,t=.5;if(at)[s,t]=mesh.paramAt(at);else{s=mid(mesh.us,s);t=mid(mesh.vs,t);}
  if(how==='crosswise'){const a=mesh.splitU(s),b=mesh.splitV(t);return a||b;}
  if(how==='horizontal')return mesh.splitV(t);
  if(how==='vertical')return mesh.splitU(s);
  const [iu,du]=nearest(mesh.us,s),[iv,dv]=nearest(mesh.vs,t);
  if(iu>=0&&du<=dv)return mesh.removeSplitU(iu);
  if(iv>=0)return mesh.removeSplitV(iv);
  return false;
}

export function warpImage(image,mesh,cell=4,interpolation='bilinear'){
  const w=image.width,h=image.height,nx=Math.max(1,Math.min(512,Math.ceil(w/cell))),ny=Math.max(1,Math.min(512,Math.ceil(h/cell)));
  const verts=[];
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const dest=mesh.eval(i/nx,j/ny);if(!Number.isFinite(dest[0])||!Number.isFinite(dest[1]))throw Error('The warp mesh is not valid.');verts.push([dest,[w*i/nx,h*j/ny]]);}
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [d] of verts){x0=Math.min(x0,d[0]);y0=Math.min(y0,d[1]);x1=Math.max(x1,d[0]);y1=Math.max(y1,d[1]);}
  const lim=1<<20;x0=Math.max(-lim,Math.floor(x0)-1);y0=Math.max(-lim,Math.floor(y0)-1);x1=Math.min(lim,Math.ceil(x1)+1);y1=Math.min(lim,Math.ceil(y1)+1);
  const width=x1-x0,height=y1-y0;
  if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The warp result exceeds the image size limit.');
  const output=new Uint8ClampedArray(width*height*4),src=image.data,cubic=t=>{const a=-.75,near=x=>(a+2)*x*x*x-(a+3)*x*x+1,far=x=>a*(x*x*x-5*x*x+8*x-4);return [far(1+t),near(t),near(1-t),far(2-t)];},sample=(sx,sy)=>{
    if(sx<-.5||sy<-.5||sx>w||sy>h)return null;
    if(interpolation==='nearest'){const ix=Math.max(0,Math.min(w-1,Math.round(sx))),iy=Math.max(0,Math.min(h-1,Math.round(sy))),i=(iy*w+ix)*4;return [src[i],src[i+1],src[i+2],src[i+3]];}
    const left=Math.floor(sx),top=Math.floor(sy),fx=sx-left,fy=sy-top,weights=interpolation==='bicubic'?cubic(fx).flatMap((wx,x)=>cubic(fy).map((wy,y)=>[left+x-1,top+y-1,wx*wy])):[[left,top,(1-fx)*(1-fy)],[left+1,top,fx*(1-fy)],[left,top+1,(1-fx)*fy],[left+1,top+1,fx*fy]],sums=[0,0,0];let alpha=0;
    for(const [xx,yy,weight] of weights){if(!weight)continue;const ix=Math.max(0,Math.min(w-1,xx)),iy=Math.max(0,Math.min(h-1,yy)),i=(iy*w+ix)*4,a=src[i+3]/255*weight;alpha+=a;sums[0]+=src[i]*a;sums[1]+=src[i+1]*a;sums[2]+=src[i+2]*a;}
    return [alpha?sums[0]/alpha:0,alpha?sums[1]/alpha:0,alpha?sums[2]/alpha:0,Math.max(0,Math.min(255,alpha*255))];
  };
  const paint=(ia,ib,ic)=>{
    const [p0,s0]=verts[ia],[p1,s1]=verts[ib],[p2,s2]=verts[ic],det=(p1[0]-p0[0])*(p2[1]-p0[1])-(p2[0]-p0[0])*(p1[1]-p0[1]);
    if(Math.abs(det)<1e-12)return;
    const bx0=Math.max(x0,Math.floor(Math.min(p0[0],p1[0],p2[0])-.5)),by0=Math.max(y0,Math.floor(Math.min(p0[1],p1[1],p2[1])-.5)),bx1=Math.min(x1,Math.ceil(Math.max(p0[0],p1[0],p2[0])+.5)),by1=Math.min(y1,Math.ceil(Math.max(p0[1],p1[1],p2[1])+.5));
    for(let y=by0;y<by1;y++)for(let x=bx0;x<bx1;x++){const px=x+.5,py=y+.5,l1=((px-p0[0])*(p2[1]-p0[1])-(p2[0]-p0[0])*(py-p0[1]))/det,l2=((p1[0]-p0[0])*(py-p0[1])-(px-p0[0])*(p1[1]-p0[1]))/det,l0=1-l1-l2;if(l0<-1e-9||l1<-1e-9||l2<-1e-9)continue;const color=sample(l0*s0[0]+l1*s1[0]+l2*s2[0],l0*s0[1]+l1*s1[1]+l2*s2[1]);if(!color)continue;const o=((y-y0)*width+(x-x0))*4;output[o]=color[0];output[o+1]=color[1];output[o+2]=color[2];output[o+3]=color[3];}
  };
  const stride=nx+1;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*stride+i;paint(a,a+1,a+stride+1);paint(a,a+stride+1,a+stride);}
  return {x:x0,y:y0,width,height,data:output};
}
