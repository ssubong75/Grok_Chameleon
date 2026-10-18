export function parseStops(text,foreground,background){
  if(!String(text||'').trim())return[[0,foreground],[1,background]];
  const stops=String(text).split(/[,\n]+/).map(entry=>{const match=entry.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i);if(!match)throw Error('Use gradient stops such as 0:#000000, 50:#ff0000, 100:#ffffff.');return[Number(match[1])/100,match[2]];});
  if(stops.length<2||stops.some(([position])=>position<0||position>1))throw Error('Add at least two gradient stops between 0 and 100.');return stops.sort((a,b)=>a[0]-b[0]);
}
export function gradientImage(width,height,start,end,options,stops){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),dx=end.x-start.x,dy=end.y-start.y,length=Math.max(.0001,Math.hypot(dx,dy)),angle=Math.atan2(dy,dx);
  const ramp=document.createElement('canvas');ramp.width=1024;ramp.height=1;const paint=ramp.getContext('2d'),gradient=paint.createLinearGradient(0,0,1023,0);for(const [position,color]of stops)gradient.addColorStop(options.reverse?1-position:position,color);paint.fillStyle=gradient;paint.fillRect(0,0,1024,1);const colors=paint.getImageData(0,0,1024,1).data;
  const image=ctx.createImageData(width,height),type=options.type||'linear';for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const px=x-start.x,py=y-start.y,projection=(px*dx+py*dy)/(length*length),perpendicular=(-px*dy+py*dx)/(length*length);let t=projection;
    if(type==='radial')t=Math.hypot(px,py)/length;else if(type==='reflected')t=Math.abs(projection);else if(type==='diamond')t=Math.abs(projection)+Math.abs(perpendicular);else if(type==='angle')t=((Math.atan2(py,px)-angle)/(Math.PI*2)+1)%1;
    if(options.layout){const layout=options.layout,a=(Number(layout.angle)||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),ox=x+.5-width/2-(Number(layout.offsetX)||0),oy=y+.5-height/2-(Number(layout.offsetY)||0),scale=Math.max(.001,Number(layout.scale)||1),along=ox*c-oy*s,across=ox*s+oy*c,chord=Math.max(1,Math.min(width/Math.max(1e-6,Math.abs(c)),height/Math.max(1e-6,Math.abs(s))))*scale,extent=Math.max(1,Math.hypot(c*width,s*height))*scale,corner=.5*(c-s);t=type==='radial'?Math.hypot(ox,oy)/(extent/2):type==='reflected'?Math.abs((along-corner)/(chord/2)):type==='diamond'?(Math.abs(along)+Math.abs(across))/(extent/2):type==='angle'?((a-Math.atan2(-oy,ox))/(Math.PI*2)%1+1)%1:(along-corner)/chord+.5;}
    const index=Math.round(Math.max(0,Math.min(1,t))*1023)*4,i=(y*width+x)*4;image.data.set(colors.subarray(index,index+4),i);
  }ctx.putImageData(image,0,0);return canvas;
}
