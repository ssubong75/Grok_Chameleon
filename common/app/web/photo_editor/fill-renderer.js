import {gradientImage,parseStops} from './gradient-renderer.js';
export function renderFill(settings){
  const width=settings.width,height=settings.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>64000000)throw Error('Invalid fill layer dimensions.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),first=settings.colorA||'#000000',second=settings.colorB||'#ffffff';
  if(settings.type==='gradient'){
    const angle=(Number(settings.angle)||0)*Math.PI/180,length=Math.hypot(width,height)*Math.max(.01,Number(settings.scale)/100||1),dx=Math.cos(angle)*length/2,dy=Math.sin(angle)*length/2;
    return gradientImage(width,height,{x:width/2-dx,y:height/2-dy},{x:width/2+dx,y:height/2+dy},{type:settings.style||'linear',reverse:settings.reverse,layout:{angle:Number(settings.angle)||0,scale:Math.max(.01,Number(settings.scale)/100||1),offsetX:settings.offsetX,offsetY:settings.offsetY}},parseStops(settings.stops,first,second));
  }
  if(settings.type==='pattern'){
    const cell=Math.max(2,Math.min(1000,Math.round(Number(settings.cell)||24))),tile=document.createElement('canvas');tile.width=tile.height=cell*2;const paint=tile.getContext('2d');paint.fillStyle=second;paint.fillRect(0,0,tile.width,tile.height);paint.fillStyle=first;
    if(settings.style==='dots'){paint.beginPath();paint.arc(cell,cell,cell*.3,0,Math.PI*2);paint.fill();}
    else if(settings.style==='stripes')paint.fillRect(0,0,cell,tile.height);
    else{paint.fillRect(0,0,cell,cell);paint.fillRect(cell,cell,cell,cell);}
    const pattern=ctx.createPattern(tile,'repeat'),scale=Math.max(.01,Number(settings.scale)/100||1);pattern.setTransform(new DOMMatrix().translate(Number(settings.offsetX)||0,Number(settings.offsetY)||0).rotate(Number(settings.angle)||0).scale(scale));ctx.fillStyle=pattern;
  }else ctx.fillStyle=first;
  ctx.fillRect(0,0,width,height);return canvas;
}
