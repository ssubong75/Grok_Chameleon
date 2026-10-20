const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function zigzag(image,settings={}){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),ox=Number(settings.x)||0,oy=Number(settings.y)||0,bw=Number(settings.documentWidth)||width,bh=Number(settings.documentHeight)||height,cx=bw/2,cy=bh/2,radius=Math.min(bw,bh)/2,rawAmount=Number(settings.amount),amount=clamp(Number.isFinite(rawAmount)?rawAmount/100:.1,-1,1),rawRidges=Number(settings.ridges),ridges=Math.max(.5,clamp(Number.isFinite(rawRidges)?rawRidges:5,0,20));
  const read=(x,y,c)=>{x=clamp(x,0,bw-1)-ox;y=clamp(y,0,bh-1)-oy;return x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+c];};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const fx=x+ox+.5,fy=y+oy+.5,dx=fx-cx,dy=fy-cy,r=Math.hypot(dx,dy);if(r>=radius||r<=0||amount===0)continue;
    const normalized=r/radius,wave=Math.sin(Math.PI*2*ridges*normalized)*(1-normalized),radial=settings.style==='aroundCenter'?0:amount*wave*radius/((settings.style==='outFromCenter'?4:8)*ridges),angular=settings.style==='outFromCenter'?0:amount*wave*Math.PI/((settings.style==='aroundCenter'?2:4)*ridges),angle=Math.atan2(dy,dx)+angular,rs=Math.max(0,r+radial),sx=cx+rs*Math.cos(angle)-.5,sy=cy+rs*Math.sin(angle)-.5,left=Math.floor(sx),top=Math.floor(sy),tx=sx-left,ty=sy-top,sum=[0,0,0];let alpha=0;
    for(const [px,py,weight]of [[left,top,(1-tx)*(1-ty)],[left+1,top,tx*(1-ty)],[left,top+1,(1-tx)*ty],[left+1,top+1,tx*ty]]){const a=read(px,py,3)/255*weight;alpha+=a;for(let c=0;c<3;c++)sum[c]+=read(px,py,c)*a;}
    const index=(y*width+x)*4;for(let c=0;c<3;c++)data[index+c]=alpha?sum[c]/alpha:0;data[index+3]=alpha*255;
  }
  return image;
}
