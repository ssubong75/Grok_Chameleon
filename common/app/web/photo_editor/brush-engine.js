export function colorLuminance(color){const hex=String(color).replace('#','');return(parseInt(hex.slice(0,2),16)*.2126+parseInt(hex.slice(2,4),16)*.7152+parseInt(hex.slice(4,6),16)*.0722)/255;}
export function paintRasterStroke(canvas,from,to,{width=24,opacity=1,hardness=1,color='#000000',erase=false,clip=null,pixelated=false,shape='round',spacing=.12,flow=1}){
  const ctx=canvas.getContext('2d');ctx.save();if(clip)clip(ctx);ctx.globalCompositeOperation=erase?'destination-out':'source-over';ctx.globalAlpha=opacity;
  if(pixelated){const radius=width/2,dx=to.x-from.x,dy=to.y-from.y,length=dx*dx+dy*dy;ctx.fillStyle=color;for(let y=Math.floor(Math.min(from.y,to.y)-radius);y<=Math.ceil(Math.max(from.y,to.y)+radius);y++)for(let x=Math.floor(Math.min(from.x,to.x)-radius);x<=Math.ceil(Math.max(from.x,to.x)+radius);x++){const t=length?Math.max(0,Math.min(1,((x+.5-from.x)*dx+(y+.5-from.y)*dy)/length)):0;if(Math.hypot(x+.5-from.x-t*dx,y+.5-from.y-t*dy)<=Math.max(.71,radius))ctx.fillRect(x,y,1,1);}}
  else if(shape==='square'||spacing>.25){const distance=Math.hypot(to.x-from.x,to.y-from.y),steps=Math.max(1,Math.ceil(distance/Math.max(.5,width*spacing)));ctx.globalAlpha=opacity*flow;ctx.fillStyle=color;for(let i=0;i<=steps;i++){const t=i/steps,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;if(shape==='square')ctx.fillRect(x-width/2,y-width/2,width,width);else{ctx.beginPath();ctx.arc(x,y,width/2,0,Math.PI*2);ctx.fill();}}}
  else if(hardness>=.999){ctx.globalAlpha=opacity*flow;ctx.lineWidth=width;ctx.lineCap=ctx.lineJoin='round';ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x+.0001,to.y+.0001);ctx.stroke();}
  else{
    const distance=Math.hypot(to.x-from.x,to.y-from.y),stepSize=Math.max(.5,width*spacing),steps=Math.max(1,Math.ceil(distance/stepSize)),radius=width/2;
    const tip=document.createElement('canvas');tip.width=tip.height=Math.ceil(width)+4;const paint=tip.getContext('2d'),center=tip.width/2,gradient=paint.createRadialGradient(center,center,Math.max(0,radius*hardness),center,center,radius);
    gradient.addColorStop(0,color);gradient.addColorStop(1,color+'00');paint.fillStyle=gradient;paint.fillRect(0,0,tip.width,tip.height);
    ctx.globalAlpha=(1-(1-opacity)**.25)*flow;
    for(let i=0;i<=steps;i++){const t=i/steps;ctx.drawImage(tip,from.x+(to.x-from.x)*t-center,from.y+(to.y-from.y)*t-center);}
  }ctx.restore();
}
export function cloneStroke(target,source,from,to,offset,{width=24,opacity=1,clip=null,layerX=0,layerY=0}){
  const radius=width/2+2,left=Math.max(0,Math.floor(Math.min(from.x,to.x)-radius)),top=Math.max(0,Math.floor(Math.min(from.y,to.y)-radius)),right=Math.min(target.width,Math.ceil(Math.max(from.x,to.x)+radius)),bottom=Math.min(target.height,Math.ceil(Math.max(from.y,to.y)+radius));
  if(right<=left||bottom<=top)return;const tile=document.createElement('canvas');tile.width=right-left;tile.height=bottom-top;const paint=tile.getContext('2d');
  paint.drawImage(source,-left-layerX+offset.x,-top-layerY+offset.y);
  const coverage=document.createElement('canvas');coverage.width=tile.width;coverage.height=tile.height;const mask=coverage.getContext('2d');mask.lineWidth=width;mask.lineCap='round';mask.strokeStyle='#fff';mask.beginPath();mask.moveTo(from.x-left,from.y-top);mask.lineTo(to.x-left+.0001,to.y-top+.0001);mask.stroke();paint.globalCompositeOperation='destination-in';paint.drawImage(coverage,0,0);
  const ctx=target.getContext('2d');ctx.save();if(clip)clip(ctx);ctx.globalAlpha=opacity;ctx.drawImage(tile,left,top);ctx.restore();
}
export function paintMaskStroke(mask,from,to,{width=24,opacity=1,color='#ffffff',erase=false,clip=null}){
  const radius=width/2+2,x=Math.max(0,Math.floor(Math.min(from.x,to.x)-radius)),y=Math.max(0,Math.floor(Math.min(from.y,to.y)-radius));
  const right=Math.min(mask.width,Math.ceil(Math.max(from.x,to.x)+radius)),bottom=Math.min(mask.height,Math.ceil(Math.max(from.y,to.y)+radius));if(right<=x||bottom<=y)return;
  const coverage=document.createElement('canvas');coverage.width=right-x;coverage.height=bottom-y;const brush=coverage.getContext('2d');brush.translate(-x,-y);if(clip)clip(brush);brush.strokeStyle='#fff';brush.lineWidth=width;brush.lineCap=brush.lineJoin='round';brush.globalAlpha=opacity;brush.beginPath();brush.moveTo(from.x,from.y);brush.lineTo(to.x+.0001,to.y+.0001);brush.stroke();
  const weights=brush.getImageData(0,0,coverage.width,coverage.height).data,ctx=mask.getContext('2d'),pixels=ctx.getImageData(x,y,coverage.width,coverage.height),target=erase?0:colorLuminance(color)*255;
  for(let i=0;i<pixels.data.length;i+=4){const weight=weights[i+3]/255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;pixels.data[i+3]=pixels.data[i+3]*(1-weight)+target*weight;}ctx.putImageData(pixels,x,y);
}
