const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hash(x,y,c,seed){let h=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(c,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>8)/16777216;}
function color(value,fallback){const match=String(value||'').match(/^#([0-9a-f]{6})$/i);return match?[0,2,4].map(i=>parseInt(match[1].slice(i,i+2),16)).concat(255):fallback;}
export function tiles(image,settings={}){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),originX=Number(settings.x)||0,originY=Number(settings.y)||0,bw=Number(settings.documentWidth)||width,bh=Number(settings.documentHeight)||height,size=Math.max(1,Math.min(bw,bh)/clamp(Math.trunc(Number(settings.count)||10),1,99)),maximum=clamp(Number(settings.maxOffset)||10,0,99)/100*size,seed=(Number(settings.seed)||0)>>>0,foreground=color(settings.foreground,[0,0,0,255]),background=color(settings.background,[255,255,255,255]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const gx=x+originX,gy=y+originY;if(gx<0||gy<0||gx>=bw||gy>=bh)continue;
    const fx=gx+.5,fy=gy+.5,gridX=Math.floor(fx/size),gridY=Math.floor(fy/size),index=(y*width+x)*4;let hit=null;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const cx=gridX+dx,cy=gridY+dy,ox=(hash(cx,cy,31,seed)*2-1)*maximum,oy=(hash(cx,cy,32,seed)*2-1)*maximum,u=fx-ox-cx*size,v=fy-oy-cy*size;if(u>=0&&v>=0&&u<size&&v<size&&cx*size<bw&&cy*size<bh&&cx>=0&&cy>=0&&(!hit||cy>hit.cy||cy===hit.cy&&cx>hit.cx))hit={cx,cy,ox,oy};}
    if(hit){const sx=clamp(Math.floor(fx-hit.ox),0,bw-1)-originX,sy=clamp(Math.floor(fy-hit.oy),0,bh-1)-originY;for(let c=0;c<4;c++)data[index+c]=sx<0||sy<0||sx>=width||sy>=height?0:source[(sy*width+sx)*4+c];}
    else if(settings.fill==='inverse')for(let c=0;c<3;c++)data[index+c]=255-source[index+c];
    else if(settings.fill!=='unaltered')data.set(settings.fill==='foreground'?foreground:background,index);
  }
  return image;
}
