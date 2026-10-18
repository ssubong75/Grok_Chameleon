export function renderShape(canvas,shape){
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.beginPath();
  const {x,y,w,h}=shape,radius=Math.max(0,Math.min(w/2,h/2,Number(shape.radius)||0));
  if(shape.type==='ellipse')ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);
  else if(shape.type==='polygon'||shape.type==='star'){
    const sides=Math.max(3,Math.min(100,Math.round(shape.sides)||5)),points=shape.type==='star'?sides*2:sides,inner=Math.max(.05,Math.min(1,Number(shape.inner)||.5));
    for(let i=0;i<points;i++){const angle=-Math.PI/2+i/points*Math.PI*2,factor=shape.type==='star'&&i%2?inner:1,px=x+w/2+Math.cos(angle)*w/2*factor,py=y+h/2+Math.sin(angle)*h/2*factor;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();
  }else if(shape.type==='line'){ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);}
  else ctx.roundRect(x,y,w,h,radius);
  if(shape.fillEnabled!==false&&shape.type!=='line'){ctx.fillStyle=shape.fill||'#000000';ctx.fill();}
  if(shape.strokeEnabled||shape.type==='line'){ctx.strokeStyle=shape.stroke||'#000000';ctx.lineWidth=Math.max(.1,Number(shape.strokeWidth)||1);ctx.lineJoin='round';ctx.stroke();}
}
