import {smooth} from './gaussian-levels.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const step=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const sigma=blur=>clamp(blur,0,500)*.6;
function pinList(settings,kind){
  const raw=String(settings.pins??'').trim();
  const pins=raw?JSON.parse(raw):[{x:settings.centerX??.5,y:settings.centerY??.5,blur:settings.blur??15,radiusX:settings.radiusX??.35,radiusY:settings.radiusY??.25,angle:settings.angle??0,roundness:settings.roundness??0,feather:settings.feather??.5}];
  if(!Array.isArray(pins)||pins.length>1024)throw Error('Pins must be an array with at most 1024 entries.');
  for(const p of pins){if(!p||!['x','y','blur'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])))throw Error('Each pin requires finite x, y and blur numbers.');if(kind==='Iris Blur'&&!['radiusX','radiusY'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])))throw Error('Iris pins require radiusX and radiusY.');for(const k of ['angle','roundness','feather'])if(p[k]!==undefined&&!Number.isFinite(p[k]))throw Error('Pin settings must be finite numbers.');}
  return pins;
}
export function blurGallery(image,kind,settings={}){
  const {width:w,height:h,data}=image,ox=Number(settings.x)||0,oy=Number(settings.y)||0,dw=Number(settings.documentWidth)||w,dh=Number(settings.documentHeight)||h,short=Math.max(1,Math.min(dw,dh));
  let maximum,at;
  if(kind==='Tilt-Shift Blur'){
    maximum=sigma(Number(settings.blur??15));const a=Number(settings.angle??0)*Math.PI/180,nx=Math.sin(a),ny=Math.cos(a),cx=Number(settings.centerX??.5)*dw,cy=Number(settings.centerY??.5)*dh,focus=Math.max(0,Number(settings.focus??.1)),end=focus+Math.max(.001,Number(settings.transition??.15));
    at=(x,y)=>maximum*step(focus,end,Math.abs((x-cx)*nx+(y-cy)*ny)/short);
  }else{
    const pins=pinList(settings,kind);if(!pins.length)return image;maximum=Math.max(...pins.map(p=>sigma(p.blur)));
    const points=pins.map(p=>{const a=(p.angle??0)*Math.PI/180;return{...p,cx:p.x*dw,cy:p.y*dh,s:sigma(p.blur),rx:Math.max(.001,p.radiusX??.35)*short,ry:Math.max(.001,p.radiusY??.25)*short,sin:Math.sin(a),cos:Math.cos(a),m:2+clamp(p.roundness??0,0,100)*.06,f:clamp(p.feather??.5,0,.999)};});
    if(kind==='Field Blur')at=(x,y)=>{let sum=0,total=0;for(const p of points){const weight=1/((x-p.cx)**2+(y-p.cy)**2+1);sum+=weight*p.s;total+=weight;}return sum/total;};
    else at=(x,y)=>{let result=maximum;for(const p of points){const dx=x-p.cx,dy=y-p.cy,u=(dx*p.cos+dy*p.sin)/p.rx,v=(-dx*p.sin+dy*p.cos)/p.ry,e=Math.abs(u)>=1||Math.abs(v)>=1?Infinity:Math.abs(p.m-2)<.001?Math.hypot(u,v):(Math.abs(u)**p.m+Math.abs(v)**p.m)**(1/p.m);result=Math.min(result,p.s*step(p.f,1,e));}return result;};
  }
  if(maximum<.3)return image;
  const source=new Uint8ClampedArray(data),levels=[0,...Array.from({length:6},(_,i)=>maximum/2**(5-i))];
  const weight=(k,s)=>{const c=levels[k];if(k>0&&s>=levels[k-1]&&s<=c)return(s-levels[k-1])/Math.max(1e-6,c-levels[k-1]);if(k+1<levels.length&&s>=c&&s<=levels[k+1])return(levels[k+1]-s)/Math.max(1e-6,levels[k+1]-c);return k===levels.length-1&&s>=c?1:0;};
  for(let ty=0;ty<h;ty+=128)for(let tx=0;tx<w;tx+=128){const tw=Math.min(128,w-tx),th=Math.min(128,h-ty),values=new Float32Array(tw*th),acc=new Float32Array(tw*th*4);
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++)values[y*tw+x]=clamp(at(ox+tx+x+.5,oy+ty+y+.5),0,maximum);
    for(let k=0;k<levels.length;k++){if(!values.some(s=>weight(k,s)>0))continue;const level=levels[k],margin=k?Math.ceil(3*level+3):0,ww=tw+margin*2,wh=th+margin*2,buffer=new Float32Array(ww*wh*4);
      for(let y=0;y<wh;y++)for(let x=0;x<ww;x++){const sx=tx+x-margin,sy=ty+y-margin;if(sx<0||sy<0||sx>=w||sy>=h)continue;const i=(sy*w+sx)*4,o=(y*ww+x)*4,a=source[i+3]/255;for(let c=0;c<3;c++)buffer[o+c]=source[i+c]/255*a;buffer[o+3]=a;}
      if(k)smooth(buffer,ww,wh,4,level);
      for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const i=y*tw+x,wk=weight(k,values[i]),o=((y+margin)*ww+x+margin)*4;for(let c=0;c<4;c++)acc[i*4+c]+=buffer[o+c]*wk;}
    }
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const i=(y*tw+x)*4,o=((ty+y)*w+tx+x)*4,a=acc[i+3];for(let c=0;c<3;c++)data[o+c]=a>1e-7?acc[i+c]/a*255:0;data[o+3]=a*255;}
  }
  return image;
}
