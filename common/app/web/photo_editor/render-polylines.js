export class Spine{
  constructor(points){this.points=points;this.cumulative=[0];for(let i=1;i<points.length;i++)this.cumulative.push(this.cumulative.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));}
  get length(){return this.cumulative.at(-1);}
  at(s){const n=this.points.length;if(!n)return[[0,0],[1,0]];if(n===1)return[this.points[0],[0,-1]];s=Math.max(0,Math.min(this.length,s));let low=0,high=n-1;while(low<high){const mid=(low+high)>>1;if(this.cumulative[mid]<=s)low=mid+1;else high=mid;}const k=Math.min(n-2,Math.max(0,low-1)),a=this.points[k],b=this.points[k+1],seg=Math.max(1e-6,this.cumulative[k+1]-this.cumulative[k]),t=Math.max(0,Math.min(1,(s-this.cumulative[k])/seg)),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(1e-6,Math.hypot(dx,dy));return[[a[0]+dx*t,a[1]+dy*t],[dx/length,dy/length]];}
}
export function flattenRenderPath(path,tolerance=.5){
  const paths=[],mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];let count=0;
  function segment(out,a,b,c,d,depth=0){if(++count>262144)throw Error('The rendering path is too complex.');const dx=d[0]-a[0],dy=d[1]-a[1],l=Math.hypot(dx,dy),distance=p=>l?Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/l:Math.hypot(p[0]-a[0],p[1]-a[1]);if(depth>=18||Math.max(distance(b),distance(c))<=tolerance){out.push(d);return;}const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);segment(out,a,ab,abc,m,depth+1);segment(out,m,bcd,cd,d,depth+1);}
  for(const contour of [path,...(path.subpaths||[])]){const nodes=contour.nodes||[];if(!nodes.length)continue;const out=[[nodes[0].x,nodes[0].y]],pairs=nodes.slice(1).map((b,i)=>[nodes[i],b]);if(contour.closed&&nodes.length>1)pairs.push([nodes.at(-1),nodes[0]]);for(const [a,b]of pairs)segment(out,[a.x,a.y],[a.outX??a.x,a.outY??a.y],[b.inX??b.x,b.inY??b.y],[b.x,b.y]);paths.push(out);}return paths;
}
