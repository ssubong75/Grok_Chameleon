import {BezierMesh} from './warp-mesh.js';
const rest=()=>Array.from({length:4},(_,j)=>Array.from({length:4},(_,i)=>[i/3,j/3]));
function edgeArc(y,b,up,h){
  if(Math.abs(b)<1e-9)return Array.from({length:4},(_,i)=>[i/3,y]);
  const th=Math.abs(b)*Math.PI,k=4/3*Math.tan(th/4)*.5/Math.sin(th/2),s=(b>0)===up?-1:1,c=Math.cos(th/2),n=Math.sin(th/2),dy=s*k*n/h;
  return [[0,y],[k*c,y+dy],[1-k*c,y+dy],[1,y]];
}
function arcGrid(b,h){
  if(Math.abs(b)<1e-9)return rest();
  const up=b>0,th=Math.abs(b)*Math.PI,r=.5/Math.sin(th/2),k=4/3*Math.tan(th/4),s=up?-1:1,cy=up?h+r*Math.cos(th/2):-r*Math.cos(th/2);
  return Array.from({length:4},(_,j)=>{
    const v=j/3,big=r+h*(up?1-v:v),at=a=>[.5+big*Math.sin(a),cy+s*big*Math.cos(a)],tangent=a=>[Math.cos(a),-s*Math.sin(a)];
    const p0=at(-th/2),p3=at(th/2),t0=tangent(-th/2),t1=tangent(th/2),l=k*big;
    return [p0,[p0[0]+l*t0[0],p0[1]+l*t0[1]],[p3[0]-l*t1[0],p3[1]-l*t1[1]],p3].map(p=>[p[0],p[1]/h]);
  });
}
function blendRows(top,bottom){return Array.from({length:4},(_,j)=>{const t=j/3;return Array.from({length:4},(_,i)=>[top[i][0]+(bottom[i][0]-top[i][0])*t,top[i][1]+(bottom[i][1]-top[i][1])*t]);});}
export function presetMesh(style,bend,bounds,horizontal=0,verticalDistort=0,vertical=false){
  const [x0,y0,x1,y1]=bounds,hw=(x1-x0)/2,hh=(y1-y0)/2;
  if(!(hw>0&&hh>0))return null;
  const pct=v=>Number.isFinite(v)?Math.max(-1,Math.min(1,v/100)):0;
  const b=pct(bend),hd=pct(horizontal),vd=pct(verticalDistort);
  if(!b&&!hd&&!vd)return null;
  const aspect=hh/hw,h=vertical?1/aspect:aspect,hdx=vertical?vd:hd,vdx=vertical?hd:vd;
  let g=rest();
  if(style==='arc')g=arcGrid(b,h);
  else if(style==='arch')g=Array.from({length:4},(_,j)=>edgeArc(j/3,b,true,h));
  else if(style==='bulge')g=blendRows(edgeArc(0,b,true,h),edgeArc(1,b,false,h));
  else if(style==='arcLower')g=blendRows(g[0],edgeArc(1,b,false,h));
  else if(style==='arcUpper')g=blendRows(edgeArc(0,b,true,h),g[3]);
  else if(style==='shellLower'){const a=arcGrid(-b,h);g[3]=a[3];g[2][0]=a[2][0];g[2][3]=a[2][3];}
  else if(style==='shellUpper'){const a=arcGrid(b,h);g[0]=a[0];g[1][0]=a[1][0];g[1][3]=a[1][3];}
  else if(style==='flag')for(const row of g){row[1][1]-=2*b;row[2][1]+=2*b;}
  else if(style==='wave')for(const row of g.slice(1,3)){row[1][1]+=4/3*b;row[2][1]-=4/3*b;}
  else if(style==='fish')g.forEach((row,i)=>{const f=[-2,-2/3,2/3,2][i];row[1][1]+=f*b;row[2][1]-=f*b;});
  else if(style==='rise')for(const row of g){row[0][1]+=2*b;row[1][1]+=2*b;}
  else if(style==='fisheye')for(const [j,i,dx,dy] of [[1,1,-1,-1],[1,2,1,-1],[2,1,-1,1],[2,2,1,1]]){g[j][i][0]+=dx*2/3*b;g[j][i][1]+=dy*2/3*b;}
  else if(style==='inflate'||style==='squeeze'){const s=style==='inflate'?1:-1;for(const p of g[0].slice(1,3))p[1]-=b/3;for(const p of g[3].slice(1,3))p[1]+=b/3;for(const row of g.slice(1,3)){row[0][0]-=s*b/3;row[3][0]+=s*b/3;}for(const [j,i,dx,dy] of [[1,1,-1,-1],[1,2,1,-1],[2,1,-1,1],[2,2,1,1]]){g[j][i][0]+=s*dx*b/9;g[j][i][1]+=dy*b/9;}}
  else if(style==='twist'){const a=Math.abs(b);if(b>=0){g[1][1][0]+=a;g[1][2][1]+=a;g[2][1][1]-=a;g[2][2][0]-=a;}else{g[1][1][1]+=a;g[1][2][0]-=a;g[2][1][0]+=a;g[2][2][1]-=a;}}
  if(vdx){const moved=(row,s)=>{const m=[(row[0][0]+row[3][0])/2,(row[0][1]+row[3][1])/2];return row.map(p=>[m[0]+(p[0]-m[0])*s-p[0],m[1]+(p[1]-m[1])*s-p[1]]);};const d0=moved(g[0],1-vdx),d3=moved(g[3],1+vdx);g.forEach((row,j)=>row.forEach((p,i)=>{const t=j/3;p[0]+=d0[i][0]+(d3[i][0]-d0[i][0])*t;p[1]+=d0[i][1]+(d3[i][1]-d0[i][1])*t;}));}
  if(hdx)for(let i=0;i<4;i++){const s=1+hdx*(2*i/3-1),m=[(g[0][i][0]+g[3][i][0])/2,(g[0][i][1]+g[3][i][1])/2];for(const row of g)row[i]=[m[0]+(row[i][0]-m[0])*s,m[1]+(row[i][1]-m[1])*s];}
  if(vertical)g=Array.from({length:4},(_,j)=>Array.from({length:4},(_,i)=>[g[i][j][1],g[i][j][0]]));
  const points=g.flat().map(p=>[x0+p[0]*(x1-x0),y0+p[1]*(y1-y0)]);
  return new BezierMesh([0,1],[0,1],points);
}
