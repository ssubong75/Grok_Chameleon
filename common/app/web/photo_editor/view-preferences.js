// DOM adapter for PhotoCraft Tools/Overscroll and Enhanced Controls/trackpad rotation.
export function panPadding(width,height,overscroll){return overscroll?[Math.max(0,width/2),Math.max(0,height/2)]:[0,0];}
export function installViewPreferences({stage,artboard,preferences,getDocument,getRotation,setRotation,redraw,isFitView=()=>false}){
  const refresh=()=>{const [x,y]=panPadding(stage.clientWidth,stage.clientHeight,preferences().overscroll&&!isFitView());const padding=y+'px '+x+'px';if(stage.style.padding!==padding)stage.style.padding=padding;};
  const resize=new ResizeObserver(refresh);resize.observe(stage);let start=null;
  const begin=event=>{if(!preferences().rotateViewWithTrackpad||!getDocument()||document.querySelector('dialog[open]'))return;event.preventDefault();start={document:getDocument(),rotation:getRotation()};};
  const rotate=event=>{if(!start||!preferences().rotateViewWithTrackpad||start.document!==getDocument()||!Number.isFinite(event.rotation))return;event.preventDefault();setRotation(start.rotation+event.rotation);redraw();};
  const end=()=>{start=null;};stage.addEventListener('gesturestart',begin,{passive:false});stage.addEventListener('gesturechange',rotate,{passive:false});stage.addEventListener('gestureend',end);window.addEventListener('blur',end);refresh();return{refresh,dispose(){resize.disconnect();stage.removeEventListener('gesturestart',begin);stage.removeEventListener('gesturechange',rotate);stage.removeEventListener('gestureend',end);window.removeEventListener('blur',end);}};
}
