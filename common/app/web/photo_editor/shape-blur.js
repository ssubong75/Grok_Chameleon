import {blurSpans} from './span-blur.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function shapeInside(shape){
  const points=Array.from({length:10},(_,i)=>{const r=i%2?.42:1,a=-Math.PI/2+i*Math.PI/5;return[r*Math.cos(a),r*Math.sin(a)];});
  return(u,v)=>{const d=u*u+v*v;switch(shape){
    case 'ring':return d>=.36&&d<=1;
    case 'square':return true;
    case 'diamond':return Math.abs(u)+Math.abs(v)<=1;
    case 'triangle':return v<=.75&&Math.abs(u)<=(v+1)/1.75;
    case 'hexagon':{const seg=Math.PI/3,a=((Math.atan2(v,u)%seg)+seg)%seg-seg/2;return Math.sqrt(d)<=Math.cos(Math.PI/6)/Math.cos(a);}
    case 'star':{let hit=false;for(let i=0,j=9;i<10;j=i++){const [xi,yi]=points[i],[xj,yj]=points[j];if((yi>v)!==(yj>v)&&u<(xj-xi)*(v-yi)/(yj-yi)+xi)hit=!hit;}return hit;}
    case 'heart':{const x=u*1.2,y=-v*1.2+.15;return (x*x+y*y-1)**3-x*x*y*y*y<=0;}
    case 'cross':return Math.abs(u)<=.3||Math.abs(v)<=.3;
    default:return d<=1;
  }};
}
export function shapeBlur(image,settings={}){
  const radius=Number.isFinite(Number(settings.radius))?clamp(Number(settings.radius),0,1000):0;
  if(radius<.5)return image;
  const {width:w,height:h,data}=image,source=new Uint8ClampedArray(data),kernel=blurSpans(radius,shapeInside(settings.shape)),stride=(w+1)*4;
  // Prefix rows are consumed once, keeping scratch space independent of radius.
  const batchRows=Math.max(1,Math.min(h,Math.floor(1048576/(w*4)))),acc=new Float64Array(batchRows*w*4),prefix=new Float64Array(stride);
  const byRow=new Map();for(const [dy,a,b]of kernel.rows){if(!byRow.has(dy))byRow.set(dy,[]);byRow.get(dy).push([a,b]);}
  for(let top=0;top<h;top+=batchRows){const rows=Math.min(batchRows,h-top);acc.fill(0);
    const reach=Math.ceil(radius);
    for(let sy=Math.max(0,top-reach);sy<Math.min(h,top+rows+reach);sy++){
      prefix.fill(0);for(let x=0;x<w;x++){const i=(sy*w+x)*4,p=x*4,q=p+4,a=source[i+3]/255;for(let c=0;c<3;c++)prefix[q+c]=prefix[p+c]+source[i+c]*a;prefix[q+3]=prefix[p+3]+a;}
      for(let y=Math.max(top,sy-reach);y<Math.min(top+rows,sy+reach+1);y++){const spans=byRow.get(sy-y);if(!spans)continue;
        for(const [a,b]of spans)for(let x=0;x<w;x++){const lo=clamp(x+a,0,w)*4,hi=clamp(x+b+1,0,w)*4,i=((y-top)*w+x)*4;for(let c=0;c<4;c++)acc[i+c]+=prefix[hi+c]-prefix[lo+c];}
      }
    }
    for(let y=0;y<rows;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,o=((top+y)*w+x)*4,a=acc[i+3];for(let c=0;c<3;c++)data[o+c]=a>0?acc[i+c]/a:0;data[o+3]=255*a/kernel.count;}
  }
  return image;
}
