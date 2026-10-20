import {blurSpans,tilePrefix} from './span-blur.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hash(x,y,c,seed){let h=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(c,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>8)/16777216;}
export function lensBlur(image,settings={}){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),number=(key,fallback)=>Number.isFinite(Number(settings[key]))?Number(settings[key]):fallback,radius=clamp(number('radius',15),0,100),blades={triangle:3,square:4,pentagon:5,hexagon:6,heptagon:7,octagon:8}[settings.shape]||6,curvature=clamp(number('bladeCurvature',0),0,100)/100,rotation=number('rotation',0)*Math.PI/180,ox=number('x',0),oy=number('y',0),focal=clamp(number('focalDistance',0),0,255)/255,noise=clamp(number('noise',0),0,100)/100*.25,seed=number('seed',0)>>>0,boost=clamp(number('brightness',0),0,100)/100*4,threshold=clamp(number('threshold',255),0,255)/255,margin=Math.ceil(radius);
  const inside=(u,v)=>{const segment=Math.PI*2/blades,theta=Math.atan2(v,u),angle=((theta-(rotation-Math.PI/2))%segment+segment)%segment-segment/2,polygon=Math.cos(Math.PI/blades)/Math.cos(angle);return Math.hypot(u,v)<=polygon+(1-polygon)*curvature;},levels=Array.from({length:9},(_,i)=>blurSpans(radius*i/8,inside)),depthImage=settings.depthImage;
  for(let tileY=0;tileY<height;tileY+=128)for(let tileX=0;tileX<width;tileX+=128){
    const tw=Math.min(128,width-tileX),th=Math.min(128,height-tileY),mean=tilePrefix(source,width,height,tileX,tileY,tw,th,margin,boost,threshold),acc=new Float64Array(4),other=new Float64Array(4);
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
      const gx=tileX+x,gy=tileY+y,index=(gy*width+gx)*4;let depth=null;
      if(settings.depthMap==='transparency')depth=source[index+3]/255;
      else if(settings.depthMap==='layerMask'&&depthImage){const mx=gx+ox-depthImage.x,my=gy+oy-depthImage.y;depth=mx>=0&&my>=0&&mx<depthImage.width&&my<depthImage.height?depthImage.data[my*depthImage.width+mx]/255:0;}
      if(depth!==null&&settings.invert)depth=1-depth;const level=depth===null?8:Math.min(8,Math.abs(depth-focal)*8),lo=Math.floor(level),fraction=level-lo;
      mean(levels[lo],x+margin,y+margin,acc);if(fraction>1e-4&&lo<8){mean(levels[lo+1],x+margin,y+margin,other);for(let c=0;c<4;c++)acc[c]+=(other[c]-acc[c])*fraction;}
      const alpha=acc[3];for(let c=0;c<3;c++){let value=alpha>1e-7?acc[c]/alpha:0;if(noise>0&&alpha>0){const channel=settings.monochromatic?0:c;value+=settings.distribution==='gaussian'?Math.sqrt(-2*Math.log(Math.max(1e-7,hash(gx+ox,gy+oy,channel*2+301,seed))))*Math.cos(Math.PI*2*hash(gx+ox,gy+oy,channel*2+302,seed))*noise*.5:(hash(gx+ox,gy+oy,channel+200,seed)-.5)*2*noise;}data[index+c]=value*255;}data[index+3]=alpha*255;
    }
  }
  return image;
}
