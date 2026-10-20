import {tracePath,pathBounds} from './paths.js';
import {shapePath} from './shape-path.js';
export function renderShape(canvas,shape){
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.beginPath();
  const {x,y,w,h}=shape,radius=Math.max(0,Math.min(w/2,h/2,Number(shape.radius)||0));
  if(shape.type==='path')tracePath(ctx,shapePath(shape));
  else if(shape.type==='ellipse')ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);
  else if(shape.type==='polygon'||shape.type==='star'){
    const sides=Math.max(3,Math.min(100,Math.round(shape.sides)||5)),points=shape.type==='star'?sides*2:sides,inner=Math.max(.05,Math.min(1,Number(shape.inner)||.5));
    for(let i=0;i<points;i++){const angle=-Math.PI/2+i/points*Math.PI*2,factor=shape.type==='star'&&i%2?inner:1,px=x+w/2+Math.cos(angle)*w/2*factor,py=y+h/2+Math.sin(angle)*h/2*factor;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();
  }else if(shape.type==='line'){ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);}
  else ctx.roundRect(x,y,w,h,radius);
  if(shape.fillEnabled!==false&&shape.type!=='line'){ctx.fillStyle=shape.fill||'#000000';ctx.fill(shape.path?.fillRule||'nonzero');}
  if(shape.strokeEnabled||shape.type==='line'){ctx.strokeStyle=shape.stroke||'#000000';ctx.lineWidth=Math.max(.1,Number(shape.strokeWidth)||1);ctx.lineJoin='round';ctx.stroke();}
}
export function redrawShapeLayer(layer,shape){
  const b=pathBounds(shapePath(shape)),padding=(shape.strokeEnabled||shape.type==='line'?Math.max(.1,Number(shape.strokeWidth)||1)/2:0)+2,left=Math.floor(b.x-padding),top=Math.floor(b.y-padding),width=Math.ceil(b.x+b.w+padding)-left,height=Math.ceil(b.y+b.h+padding)-top;
  if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The shape exceeds the image size limit.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const local={...shape,x:shape.x-left,y:shape.y-top};renderShape(canvas,local);
  layer.canvas=canvas;layer.x+=left;layer.y+=top;layer.shape=local;if(layer.mask){layer.maskOffsetX=(layer.maskOffsetX||0)-left;layer.maskOffsetY=(layer.maskOffsetY||0)-top;}return layer;
}
