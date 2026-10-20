import {clamp,shade,RenderRng,capsule,ellipse,disc,renderPrimitives} from './render-primitives.js';
export const frameStyles=['vineWithFlowers','vineWithLeaves','ivy','roses','daisies','berries','bamboo','waves','zigzag','dots','rope','scallops','doubleLine','snowflakes','stars','hearts'];
const TAU=Math.PI*2;
function color(value,fallback){return /^#[0-9a-f]{6}$/i.test(value||'')?[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255).concat(1):fallback;}
class Border{
  constructor(x,y,w,h){Object.assign(this,{x,y,w,h});}get length(){return 2*(this.w+this.h);}
  at(value){const s=((value%this.length)+this.length)%this.length,{x,y,w,h}=this;return s<w?[[x+s,y],[1,0],[0,1]]:s<w+h?[[x+w,y+s-w],[0,1],[-1,0]]:s<2*w+h?[[x+w-(s-w-h),y+h],[-1,0],[0,-1]]:[[x,y+h-(s-2*w-h)],[0,-1],[1,0]];}
}
function flower(out,c,r,petals,petal,center,rot){for(let k=0;k<petals;k++){const a=rot+k/petals*TAU,p=[c[0]+Math.cos(a)*r*.55,c[1]+Math.sin(a)*r*.55];out.push(ellipse(p,r*.5,r*.26,a,petal,shade(petal,.8)));}out.push(ellipse(c,r*.28,r*.28,0,center,shade(center,.75)));}
function leaf(out,p,angle,length,col){out.push(ellipse([p[0]+Math.cos(angle)*length*.5,p[1]+Math.sin(angle)*length*.5],length*.5,length*.22,angle,shade(col,1.12),shade(col,.8)));}
function star(out,c,r,points,col,rot){for(let k=0;k<points;k++){const a=rot+k/points*TAU;out.push(capsule(c,[c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r],r*.28,.4,col));}}
export function pictureFramePrimitives(width,height,spec={}){
  const out=[],short=Math.max(8,Math.min(width,height)),margin=short*clamp(Number(spec.margin??4),0,30)/100,unit=short*(.008+clamp(Number(spec.size??50),1,100)/100*.05),thick=Math.max(.6,unit*.04+short*.00012*clamp(Number(spec.thickness??30),1,100)),spacing=unit*(4-3.2*clamp(Number(spec.arrangement??50),1,100)/100),inset=margin+unit,b=new Border(inset,inset,Math.max(1,width-2*inset),Math.max(1,height-2*inset)),total=b.length,count=Math.max(4,Math.round(total/spacing)),step=total/count,frame=typeof spec.frame==='string'?Math.max(0,frameStyles.indexOf(spec.frame))+1:clamp(Math.round(spec.frame??1),1,16),style=frameStyles[frame-1],rng=new RenderRng(Number(spec.seed)||0,0xf8a3e+frame),vine=color(spec.vineColor,[.25,.4,.15,1]),fl=color(spec.flowerColor,[.9,.3,.45,1]),lf=color(spec.leafColor,[.3,.6,.2,1]),lines=clamp(Math.round(spec.lines??1),1,5),white=[1,1,1,1],yellow=[.98,.82,.2,1];
  const wave=(s,amp,wl)=>amp*Math.sin(s/wl*TAU);
  const vinePath=(amp,wl,col,r)=>{const n=Math.max(8,Math.ceil(total/3));let prev=null;for(let k=0;k<=n;k++){const s=k/n*total,[p,,nn]=b.at(s),o=wave(s,amp,wl),q=[p[0]+nn[0]*o,p[1]+nn[1]*o];if(prev)out.push(capsule(prev,q,r,r,col));prev=q;}};
  if(['vineWithFlowers','vineWithLeaves','ivy','roses','daisies','berries'].includes(style)){
    const amp=unit*.5,wl=step*2;vinePath(amp,wl,vine,thick);
    for(let k=0;k<count;k++){const s=k*step+step*.5,[p,t,nn]=b.at(s),o=wave(s,amp,wl),q=[p[0]+nn[0]*o,p[1]+nn[1]*o],side=k%2===0?1:-1,ta=Math.atan2(t[1],t[0]),la=ta+side*.9+rng.sym()*.3,ll=unit*rng.range(.9,1.2);
      if(style==='vineWithFlowers'){leaf(out,q,la,ll,lf);if(k%2===0)flower(out,[q[0]+nn[0]*unit*.7*side,q[1]+nn[1]*unit*.7*side],unit*.65,5,fl,yellow,rng.f()*6.3);}
      else if(style==='vineWithLeaves'){leaf(out,q,la,ll,lf);leaf(out,q,ta-side*.9,ll*.8,lf);}
      else if(style==='ivy'){for(let j=0;j<3;j++)leaf(out,q,la+(j-1)*.7,ll*.75,shade(lf,.75+.15*j));}
      else if(style==='roses'){leaf(out,q,la,ll,lf);if(k%3===0)for(const [j,f]of [1,.75,.5,.28].entries())out.push(ellipse(q,unit*.7*f,unit*.7*f*.9,rng.f()*3,shade(fl,.75+.1*j),shade(fl,.55)));}
      else if(style==='daisies'){leaf(out,q,la,ll*.8,lf);if(k%2===1)flower(out,q,unit*.6,12,white,yellow,rng.f());}
      else{leaf(out,q,la,ll,lf);for(let j=0;j<3;j++)out.push(ellipse([q[0]+rng.sym()*unit*.4,q[1]+rng.sym()*unit*.4],unit*.2,unit*.2,0,shade(fl,1.2),shade(fl,.6)));}
    }
  }else if(style==='bamboo'){
    for(let edge=0;edge<4;edge++){const [s0,l]=[[0,b.w],[b.w,b.h],[b.w+b.h,b.w],[2*b.w+b.h,b.h]][edge],a=b.at(s0+.01)[0],z=b.at(s0+l-.01)[0],joints=Math.max(1,Math.round(l/(spacing*2))),along=f=>[a[0]+(z[0]-a[0])*f,a[1]+(z[1]-a[1])*f];for(let j=0;j<joints;j++){const p0=along(j/joints),p1=along((j+1)/joints);out.push(capsule(p0,p1,unit*.35,unit*.35,vine,shade(vine,.8)),disc(p1,unit*.4,shade(vine,.7)));}for(let j=0;j<Math.max(1,Math.floor(joints/2));j++)leaf(out,along(rng.f()),rng.f()*6.3,unit*1.4,lf);}
  }else if(['waves','zigzag','doubleLine','rope'].includes(style)){
    for(let li=0;li<lines;li++){const off=(li-(lines-1)/2)*thick*4,n=Math.max(8,Math.ceil(total/2));let prev=null;for(let k=0;k<=n;k++){const s=k/n*total,[p,,nn]=b.at(s),o=off+(style==='waves'?wave(s+li*step*.25,unit*.4,step):style==='zigzag'?unit*.4*(4*Math.abs((s/step)%1-.5)-1):0),q=[p[0]+nn[0]*o,p[1]+nn[1]*o];if(style==='rope'){if(k%2===0){const t=b.at(s)[1];out.push(ellipse(q,unit*.45,unit*.2,Math.atan2(t[1],t[0])+.7,shade(vine,1.1),shade(vine,.65)));}}else if(prev)out.push(capsule(prev,q,thick,thick,vine));prev=q;}
      if(style==='doubleLine'){const inner=new Border(b.x+unit*.6+off,b.y+unit*.6+off,b.w-2*(unit*.6+off),b.h-2*(unit*.6+off)),starts=[0,inner.w,inner.w+inner.h,2*inner.w+inner.h],ends=[inner.w,inner.w+inner.h,2*inner.w+inner.h,inner.length-.001];for(let e=0;e<4;e++)out.push(capsule(inner.at(starts[e])[0],inner.at(ends[e])[0],thick*.6,thick*.6,vine));}
    }
    if(style==='doubleLine')for(const s of [0,b.w,b.w+b.h,2*b.w+b.h])out.push(ellipse(b.at(s)[0],unit*.45,unit*.45,Math.PI/4,fl));
  }else{
    for(let k=0;k<count;k++){const s=k*step,[p,t,nn]=b.at(s),ta=Math.atan2(t[1],t[0]);
      if(style==='dots'){const r=unit*(k%2===0?.4:.22);out.push(ellipse(p,r,r,0,shade(fl,1.15),shade(fl,.75)));}
      else if(style==='scallops'){const c0=b.at(s-step*.5)[0],mid=[(c0[0]+p[0])/2,(c0[1]+p[1])/2],pt=a=>[mid[0]-t[0]*step*.5*Math.cos(a)-nn[0]*step*.5*Math.sin(a),mid[1]-t[1]*step*.5*Math.cos(a)-nn[1]*step*.5*Math.sin(a)];for(let j=0;j<8;j++)out.push(capsule(pt(Math.PI*j/8),pt(Math.PI*(j+1)/8),thick,thick,vine));}
      else if(style==='snowflakes'){const r=unit*.6,c=[.85,.92,1,1];for(let j=0;j<6;j++){const a=ta+j*Math.PI/3,e=[p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r],m=[p[0]+Math.cos(a)*r*.6,p[1]+Math.sin(a)*r*.6];out.push(capsule(p,e,Math.max(.6,thick*.6),Math.max(.5,thick*.4),c));for(const sd of [-.7,.7])out.push(capsule(m,[m[0]+Math.cos(a+sd)*r*.3,m[1]+Math.sin(a+sd)*r*.3],Math.max(.5,thick*.4),.4,c));}}
      else if(style==='stars')star(out,p,unit*.55,5,k%2===0?yellow:fl,ta-Math.PI/2);
      else if(style==='hearts'){const r=unit*.3,l=[p[0]-t[0]*r*.8-nn[0]*r*.3,p[1]-t[1]*r*.8-nn[1]*r*.3],rr=[p[0]+t[0]*r*.8-nn[0]*r*.3,p[1]+t[1]*r*.8-nn[1]*r*.3],tip=[p[0]+nn[0]*r*1.6,p[1]+nn[1]*r*1.6];out.push(capsule(l,tip,r,.6,fl),capsule(rr,tip,r,.6,fl));}
    }
  }
  const fade=clamp(Number(spec.fade??0),0,100)/100;if(fade>0)for(const p of out){const c=p.type==='capsule'?p.a:p.center,edge=clamp(Math.max(Math.abs(c[0]-width/2)/(b.w/2),Math.abs(c[1]-height/2)/(b.h/2)),0,1),k=clamp(1-fade*(1-edge)*8,0,1);p.c0[3]*=k;p.c1[3]*=k;}
  return out;
}
export function pictureFrame(image,settings={}){return renderPrimitives(image,pictureFramePrimitives(Number(settings.documentWidth)||image.width,Number(settings.documentHeight)||image.height,settings),settings);}
