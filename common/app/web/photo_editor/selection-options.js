// Options-bar selection mode and marquee Style. PhotoCraft tool_feedback.rs and chrome_ui.rs marquee_end.
const MODES=['replace','add','subtract','intersect'];
export function selectionCombine(bar,event){
  if(event?.shiftKey&&event?.altKey)return 'intersect';
  if(event?.shiftKey)return 'add';
  if(event?.altKey)return 'subtract';
  return MODES[Math.max(0,Math.min(3,bar|0))]||'replace';
}
export function marqueeEnd(style,width,height,shift,start,end){
  const dx=end.x-start.x,dy=end.y-start.y,sx=dx<0?-1:1,sy=dy<0?-1:1;
  if(style==='fixedSize'||style==='size')return {x:start.x+sx*Math.max(1,width),y:start.y+sy*Math.max(1,height)};
  if((style==='fixedRatio'||style==='ratio')&&width>0&&height>0){const k=Math.max(Math.abs(dx)/width,Math.abs(dy)/height);return {x:start.x+sx*k*width,y:start.y+sy*k*height};}
  if(shift){const m=Math.max(Math.abs(dx),Math.abs(dy));return {x:start.x+sx*m,y:start.y+sy*m};}
  return end;
}
