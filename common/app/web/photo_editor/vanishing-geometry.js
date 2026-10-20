import {quadMapping} from './perspective.js';
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>mul(a,1/Math.max(1e-300,Math.hypot(...a)));
const meet=(a,b,c,d)=>cross(cross([...a,1],[...b,1]),cross([...c,1],[...d,1]));
export class Homography{
  constructor(values){this.values=values.length===8?[...values,1]:values;}
  apply(x,y){const a=this.values,z=a[6]*x+a[7]*y+a[8];return[(a[0]*x+a[1]*y+a[2])/z,(a[3]*x+a[4]*y+a[5])/z];}
  localScale(x,y){const e=.5,a=this.apply(x-e,y),b=this.apply(x+e,y),c=this.apply(x,y-e),d=this.apply(x,y+e),jx=[b[0]-a[0],b[1]-a[1]],jy=[d[0]-c[0],d[1]-c[1]];return Math.sqrt(Math.abs(jx[0]*jy[1]-jx[1]*jy[0]));}
  inverse(){const a=this.values,c=[a[4]*a[8]-a[5]*a[7],a[2]*a[7]-a[1]*a[8],a[1]*a[5]-a[2]*a[4],a[5]*a[6]-a[3]*a[8],a[0]*a[8]-a[2]*a[6],a[2]*a[3]-a[0]*a[5],a[3]*a[7]-a[4]*a[6],a[1]*a[6]-a[0]*a[7],a[0]*a[4]-a[1]*a[3]],det=a[0]*c[0]+a[1]*c[3]+a[2]*c[6];if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;return new Homography(c.map(v=>v/det));}
  multiply(other){const a=this.values,b=other.values,out=[];for(let y=0;y<3;y++)for(let x=0;x<3;x++)out.push(a[y*3]*b[x]+a[y*3+1]*b[3+x]+a[y*3+2]*b[6+x]);return new Homography(out);}
}
export class VanishingPlane{
  constructor(corners){if(!Array.isArray(corners)||corners.length!==4||corners.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)))throw Error('A plane requires four finite [x, y] corners.');this.corners=corners.map(p=>[...p]);}
  homography(){try{return new Homography(quadMapping([[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>({x,y})),this.corners.map(([x,y])=>({x,y}))));}catch{return null;}}
  turns(){const q=this.corners,out=[];for(let i=0;i<4;i++){const a=sub(q[(i+1)%4],q[i]),b=sub(q[(i+2)%4],q[(i+1)%4]),la=Math.hypot(...a),lb=Math.hypot(...b);if(la<1||lb<1)return null;out.push((a[0]*b[1]-a[1]*b[0])/(la*lb));}return out;}
  focal(center){const q=this.corners,v1=meet(q[0],q[1],q[3],q[2]),v2=meet(q[0],q[3],q[1],q[2]);if(Math.abs(v1[2])<1e-9||Math.abs(v2[2])<1e-9)return null;const a=[v1[0]/v1[2]-center[0],v1[1]/v1[2]-center[1]],b=[v2[0]/v2[2]-center[0],v2[1]/v2[2]-center[1]],f2=-dot(a,b);return f2>1?Math.sqrt(f2):null;}
  check(center){const turns=this.turns();if(!turns)return'invalid';const same=turns.every(v=>v>0)||turns.every(v=>v<0),minimum=Math.min(...turns.map(Math.abs));if(!same||minimum<Math.sin(Math.PI/180)||!this.homography())return'invalid';if(minimum<Math.sin(Math.PI/18))return'questionable';const q=this.corners,v1=meet(q[0],q[1],q[3],q[2]),v2=meet(q[0],q[3],q[1],q[2]),finite=v=>Math.abs(v[2])>1e-9*Math.max(1,Math.abs(v[0])+Math.abs(v[1]));return finite(v1)&&finite(v2)&&this.focal(center)===null?'questionable':'valid';}
  normalized(){let q=this.corners.map(p=>[...p]);if((this.turns()||[]).reduce((s,v)=>s+v,0)<0)q=[q[0],q[3],q[2],q[1]];let first=0;for(let i=1;i<4;i++)if(q[i][0]+q[i][1]<q[first][0]+q[first][1])first=i;return new VanishingPlane(Array.from({length:4},(_,i)=>q[(first+i)%4]));}
  lift(focal,center){const ray=p=>[(p[0]-center[0])/focal,(p[1]-center[1])/focal,1],q=this.corners,dir=(a,b,c,d)=>{const v=meet(a,b,c,d);return Math.abs(v[2])<1e-9*Math.max(1,Math.abs(v[0])+Math.abs(v[1]))?norm([v[0],v[1],0]):norm(ray([v[0]/v[2],v[1]/v[2]]));};let normal=norm(cross(dir(q[0],q[1],q[3],q[2]),dir(q[0],q[3],q[1],q[2])));if(normal[2]<0)normal=mul(normal,-1);const points=q.map(p=>{const r=ray(p);return mul(r,1/Math.max(1e-9,Math.abs(dot(normal,r))));}),length=(a,b)=>Math.hypot(...sub(a,b));return{points,focal,center,width:(length(points[0],points[1])+length(points[3],points[2]))/2,height:(length(points[0],points[3])+length(points[1],points[2]))/2,project:p=>p[2]>1e-9?[center[0]+focal*p[0]/p[2],center[1]+focal*p[1]/p[2]]:null};}
}
export class VanishingScene{
  constructor(first,center,focal=null,fallback=800){this.planes=[first];this.center=center;this.focal=focal>1?focal:first.focal(center)??fallback;}
  lifted(i){return this.planes[i].lift(this.focal,this.center);}
  frame(i){const h=this.planes[i]?.homography();if(!h)return null;const lifted=this.lifted(i);return{h,width:lifted.width,height:lifted.height};}
  planeAt(p){for(let i=this.planes.length-1;i>=0;i--){const inverse=this.planes[i].homography()?.inverse();if(!inverse)continue;const [u,v]=inverse.apply(...p);if(u>=0&&u<=1&&v>=0&&v<=1)return i;}return null;}
  tearOff(from,edge,angle=90,depth=1){const lf=this.lifted(from),p=lf.points,indices={top:[0,1,3],right:[1,2,0],bottom:[2,3,1],left:[3,0,2]}[edge];if(!indices)throw Error('Choose a plane edge.');const [ia,ib,ic]=indices,a=p[ia],b=p[ib],axis=norm(sub(b,a)),inward=sub(p[ic],p[ia]),length=Math.hypot(...inward)*Math.max(.05,depth),out=mul(norm(inward),-1),theta=(180-angle)*Math.PI/180;let best=null;
    for(const sign of [1,-1]){const s=Math.sin(sign*theta),c=Math.cos(sign*theta),rotation=add(add(mul(out,c),mul(cross(axis,out),s)),mul(axis,dot(axis,out)*(1-c))),a2=add(a,mul(rotation,length)),b2=add(b,mul(rotation,length)),pa=lf.project(a),pb=lf.project(b),pa2=lf.project(a2),pb2=lf.project(b2);if(!pa||!pb||!pa2||!pb2)continue;let normal=norm(cross(sub(b,a),sub(a2,a)));if(dot(normal,a)>0)normal=mul(normal,-1);const score=dot(normal,inward);if(!best||score>best.score)best={score,pa,pb,pa2,pb2};}
    if(!best)return null;const {pa,pb,pa2,pb2}=best,corners=edge==='top'?[pa2,pb2,pb,pa]:edge==='right'?[pa,pa2,pb2,pb]:edge==='bottom'?[pb,pa,pa2,pb2]:[pb2,pb,pa,pa2];this.planes.push(new VanishingPlane(corners));return this.planes.length-1;
  }
}
