const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hash(x,y,seed){let h=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(21,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>8)/16777216;}
function interval(p,m,o,half){if(Math.abs(o)<1e-6)return Math.abs(p-m)<=half?[0,1]:null;const a=(p-m-half)/o,b=(p-m+half)/o,lo=Math.max(0,Math.min(a,b)),hi=Math.min(1,Math.max(a,b));return lo<=hi?[lo,hi]:null;}
export function extrude(image,settings={}){
  const {width:w,height:h,data}=image,source=new Uint8ClampedArray(data),ox=Number(settings.x)||0,oy=Number(settings.y)||0,dw=Number(settings.documentWidth)||w,dh=Number(settings.documentHeight)||h,size=Math.round(clamp(Number(settings.size)||30,2,255)),depth=clamp(Number(settings.depth)||30,1,255),reach=depth*.25,half=size/2,bcx=dw/2,bcy=dh/2,diag=Math.max(1,Math.hypot(dw,dh)/2),seed=(Number(settings.seed)||0)>>>0,k=Math.ceil(reach/size)+1;
  const read=(x,y,c)=>{x-=ox;y-=oy;return x<0||y<0||x>=w||y>=h?0:source[(Math.floor(y)*w+Math.floor(x))*4+c];};
  const cell=(cx,cy)=>{const x0=cx*size,y0=cy*size,x1=Math.min(dw,x0+size),y1=Math.min(dh,y0+size);if(settings.maskIncompleteBlocks&&(x1!==x0+size||y1!==y0+size))return null;const col=[0,0,0,0],step=Math.max(1,Math.floor(size/8));let count=0;for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){const a=read(x,y,3)/255;for(let c=0;c<3;c++)col[c]+=read(x,y,c)/255*a;col[3]+=a;count++;}if(count)for(let c=0;c<4;c++)col[c]/=count;const a=col[3];for(let c=0;c<3;c++)col[c]=a>1e-7?col[c]/a:0;const height=settings.depthMode==='levelBased'?clamp(col[0]*.299+col[1]*.587+col[2]*.114,0,1):hash(cx,cy,seed);return{col,height,mx:x0+half,my:y0+half,x0,y0};};
  const shade=(i,col,value)=>{for(let c=0;c<3;c++)data[i+c]=clamp(col[c]*value,0,1)*255;data[i+3]=col[3]*255;};
  for(let ty=0;ty<h;ty+=128)for(let tx=0;tx<w;tx+=128){const tw=Math.min(128,w-tx),th=Math.min(128,h-ty),cache=new Map(),get=(cx,cy)=>{const key=cy*Math.ceil(dw/size)+cx;if(!cache.has(key))cache.set(key,cell(cx,cy));return cache.get(key);};
    if(settings.type==='pyramids'){
      for(let y=ty;y<ty+th;y++)for(let x=tx;x<tx+tw;x++){const gx=ox+x,gy=oy+y;if(gx<0||gy<0||gx>=dw||gy>=dh)continue;const p=get(Math.floor(gx/size),Math.floor(gy/size));if(!p)continue;const u=gx+.5-p.mx,v=gy+.5-p.my,hgt=p.height*depth/255*size,nx=Math.abs(u)>=Math.abs(v)?Math.sign(u)*hgt:0,ny=Math.abs(u)>=Math.abs(v)?0:Math.sign(v)*hgt,lambert=Math.max(0,(-nx*.5-ny*.5+half*Math.SQRT1_2)/Math.hypot(nx,ny,half));shade((y*w+x)*4,p.col,.35+.9*lambert);}
      continue;
    }
    const heights=new Float64Array(tw*th);heights.fill(-Infinity);
    const cx0=Math.max(0,Math.floor((ox+tx)/size)-k),cy0=Math.max(0,Math.floor((oy+ty)/size)-k),cx1=Math.min(Math.ceil(dw/size)-1,Math.floor((ox+tx+tw-1)/size)+k),cy1=Math.min(Math.ceil(dh/size)-1,Math.floor((oy+ty+th-1)/size)+k);
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){const p=get(cx,cy);if(!p)continue;const off=reach*p.height/diag,dx=(p.mx-bcx)*off,dy=(p.my-bcy)*off,x0=Math.max(tx,Math.ceil(-ox),Math.floor(Math.min(p.mx,p.mx+dx)-half)-2-ox),x1=Math.min(tx+tw,Math.ceil(dw-ox),Math.ceil(Math.max(p.mx,p.mx+dx)+half)+2-ox),y0=Math.max(ty,Math.ceil(-oy),Math.floor(Math.min(p.my,p.my+dy)-half)-2-oy),y1=Math.min(ty+th,Math.ceil(dh-oy),Math.ceil(Math.max(p.my,p.my+dy)+half)+2-oy);
      for(let y=Math.ceil(y0);y<y1;y++){if(Math.abs(cy-Math.floor((oy+y)/size))>k)continue;const iy=interval(oy+y+.5,p.my,dy,half);if(!iy)continue;for(let x=Math.ceil(x0);x<x1;x++){if(Math.abs(cx-Math.floor((ox+x)/size))>k)continue;const j=(y-ty)*tw+x-tx;if(heights[j]>=p.height)continue;const fx=ox+x+.5,ix=interval(fx,p.mx,dx,half);if(!ix||Math.max(ix[0],iy[0])>Math.min(ix[1],iy[1]))continue;heights[j]=p.height;const hi=Math.min(ix[1],iy[1]),face=hi>=1?0:ix[1]<iy[1]?(dx>0?1:2):(dy>0?3:4),i=(y*w+x)*4;if(face===0&&!settings.solidFrontFaces){const sx=clamp(Math.floor(fx-dx),p.x0,p.x0+size-1),sy=clamp(Math.floor(oy+y+.5-dy),p.y0,p.y0+size-1);for(let c=0;c<4;c++)data[i+c]=read(sx,sy,c);}else shade(i,p.col,[1,.85,.55,.95,.45][face]);}}
    }
  }
  return image;
}
