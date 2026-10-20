// Port of PhotoCraft crates/geom/src/warp.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors. MIT; see vendor/photocraft.LICENSE-MIT.
export const warpStyles=[['arc','Arc'],['arcLower','Arc Lower'],['arcUpper','Arc Upper'],['arch','Arch'],['bulge','Bulge'],['shellLower','Shell Lower'],['shellUpper','Shell Upper'],['flag','Flag'],['wave','Wave'],['fish','Fish'],['rise','Rise'],['fisheye','Fisheye'],['inflate','Inflate'],['squeeze','Squeeze'],['twist','Twist']];
const rest=()=>Array.from({length:4},(_,j)=>Array.from({length:4},(_,i)=>[i/3,j/3]));
function edgeArc(y,b,up,h){
  if(Math.abs(b)<1e-9)return Array.from({length:4},(_,i)=>[i/3,y]);
  const theta=Math.abs(b)*Math.PI,k=4/3*Math.tan(theta/4)*.5/Math.sin(theta/2),s=(b>0)===up?-1:1,c=Math.cos(theta/2),n=Math.sin(theta/2),dy=s*k*n/h;
  return[[0,y],[k*c,y+dy],[1-k*c,y+dy],[1,y]];
}
function arcGrid(b,h){
  if(Math.abs(b)<1e-9)return rest();const up=b>0,theta=Math.abs(b)*Math.PI,r=.5/Math.sin(theta/2),k=4/3*Math.tan(theta/4),s=up?-1:1,cy=up?h+r*Math.cos(theta/2):-r*Math.cos(theta/2);
  return Array.from({length:4},(_,j)=>{const v=j/3,big=r+h*(up?1-v:v),at=a=>[.5+big*Math.sin(a),cy+s*big*Math.cos(a)],tangent=a=>[Math.cos(a),-s*Math.sin(a)],p0=at(-theta/2),p3=at(theta/2),t0=tangent(-theta/2),t1=tangent(theta/2),length=k*big;return[p0,[p0[0]+length*t0[0],p0[1]+length*t0[1]],[p3[0]-length*t1[0],p3[1]-length*t1[1]],p3].map(([x,y])=>[x,y/h]);});
}
const blend=(top,bottom)=>Array.from({length:4},(_,j)=>top.map((p,i)=>[p[0]+(bottom[i][0]-p[0])*j/3,p[1]+(bottom[i][1]-p[1])*j/3]));
function presetGrid(style,b,hd,vd,vertical,aspect){
  const h=vertical?1/aspect:aspect;if(vertical)[hd,vd]=[vd,hd];let g=rest();
  if(style==='arc')g=arcGrid(b,h);
  else if(style==='arch')g=Array.from({length:4},(_,j)=>edgeArc(j/3,b,true,h));
  else if(style==='bulge')g=blend(edgeArc(0,b,true,h),edgeArc(1,b,false,h));
  else if(style==='arcLower')g=blend(g[0],edgeArc(1,b,false,h));
  else if(style==='arcUpper')g=blend(edgeArc(0,b,true,h),g[3]);
  else if(style==='shellLower'){const a=arcGrid(-b,h);g[3]=a[3];g[2][0]=a[2][0];g[2][3]=a[2][3];}
  else if(style==='shellUpper'){const a=arcGrid(b,h);g[0]=a[0];g[1][0]=a[1][0];g[1][3]=a[1][3];}
  else if(style==='flag')for(const row of g){row[1][1]-=2*b;row[2][1]+=2*b;}
  else if(style==='wave')for(const row of g.slice(1,3)){row[1][1]+=4/3*b;row[2][1]-=4/3*b;}
  else if(style==='fish')for(let j=0;j<4;j++){const f=[-2,-2/3,2/3,2][j];g[j][1][1]+=f*b;g[j][2][1]-=f*b;}
  else if(style==='rise')for(const row of g){row[0][1]+=2*b;row[1][1]+=2*b;}
  else if(style==='fisheye')for(const [j,i,dx,dy]of [[1,1,-1,-1],[1,2,1,-1],[2,1,-1,1],[2,2,1,1]]){g[j][i][0]+=dx*2/3*b;g[j][i][1]+=dy*2/3*b;}
  else if(style==='inflate'||style==='squeeze'){
    const s=style==='inflate'?1:-1;for(const i of [1,2]){g[0][i][1]-=b/3;g[3][i][1]+=b/3;}for(const j of [1,2]){g[j][0][0]-=s*b/3;g[j][3][0]+=s*b/3;}
    for(const [j,i,dx,dy]of [[1,1,-1,-1],[1,2,1,-1],[2,1,-1,1],[2,2,1,1]]){g[j][i][0]+=s*dx*b/9;g[j][i][1]+=dy*b/9;}
  }else if(style==='twist'){const a=Math.abs(b);if(b>=0){g[1][1][0]+=a;g[1][2][1]+=a;g[2][1][1]-=a;g[2][2][0]-=a;}else{g[1][1][1]+=a;g[1][2][0]-=a;g[2][1][0]+=a;g[2][2][1]-=a;}}
  if(vd){
    const moved=(row,s)=>{const m=[(row[0][0]+row[3][0])/2,(row[0][1]+row[3][1])/2];return row.map(p=>[m[0]+(p[0]-m[0])*s-p[0],m[1]+(p[1]-m[1])*s-p[1]]);},d0=moved(g[0],1-vd),d3=moved(g[3],1+vd);
    for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<2;k++)g[j][i][k]+=d0[i][k]+(d3[i][k]-d0[i][k])*j/3;
  }
  if(hd)for(let i=0;i<4;i++){const s=1+hd*(2*i/3-1),m=[(g[0][i][0]+g[3][i][0])/2,(g[0][i][1]+g[3][i][1])/2];for(const row of g)row[i]=[m[0]+(row[i][0]-m[0])*s,m[1]+(row[i][1]-m[1])*s];}
  if(vertical)g=Array.from({length:4},(_,j)=>Array.from({length:4},(_,i)=>[g[i][j][1],g[i][j][0]]));return g;
}
const bernstein=t=>{const s=1-t;return[s*s*s,3*s*s*t,3*s*t*t,t*t*t];};
export function createStyleWarp(text,bounds){
  if(!warpStyles.some(([id])=>id===text.warpStyle)||bounds.w<=0||bounds.h<=0)return null;
  const pct=v=>Number.isFinite(Number(v))?Math.max(-1,Math.min(1,Number(v)/100)):0,b=pct(text.warpBend),hd=pct(text.warpHorizontal),vd=pct(text.warpVertical);if(!b&&!hd&&!vd)return null;
  const grid=presetGrid(text.warpStyle,b,hd,vd,text.warpAxis==='vertical',bounds.h/bounds.w);
  return{grid,point(x,y){const bu=bernstein((x-bounds.x)/bounds.w),bv=bernstein((y-bounds.y)/bounds.h);let px=0,py=0;for(let j=0;j<4;j++)for(let i=0;i<4;i++){const weight=bu[i]*bv[j];px+=weight*grid[j][i][0];py+=weight*grid[j][i][1];}return{x:bounds.x+px*bounds.w,y:bounds.y+py*bounds.h};}};
}
