// PhotoCraft ui-egui/pixel_grid.rs, 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
const cache=new WeakMap();
function cellColor(data,i){
  const a=data[i+3]/255;if(a<=0)return null;const luma=(.299*data[i]+.587*data[i+1]+.114*data[i+2])/255*a+.9*(1-a),x=Math.max(0,Math.min(1,(luma-.35)/.4)),t=Math.round(x*x*(3-2*x)*8)/8,white=.25*a*(1-t),black=.25*a*.64*t,total=white+black,alpha=Math.round(total*255);if(!alpha)return null;const grey=Math.round(white/total*255);return `rgba(${grey},${grey},${grey},${alpha/255})`;
}
function segments(image,left,top){
  const {width:w,height:h,data}=image,out=[];
  const runs=(length,at,emit)=>{let start=0,previous=null;for(let i=0;i<=length;i++){const color=i===length?null:at(i);if(color===previous)continue;if(previous){if(out.length>=60000)return false;emit(start,i,previous);}start=i;previous=color;}return true;};
  for(let x=0;x<w;x++)if(!runs(h,y=>cellColor(data,(y*w+x)*4),(a,b,color)=>out.push([left+x,top+a,left+x,top+b,color])))return out;
  for(let y=0;y<h;y++)if(!runs(w,x=>cellColor(data,(y*w+x)*4),(a,b,color)=>out.push([left+a,top+y,left+b,top+y,color])))return out;return out;
}
export function showsAt(physical){return physical>5;}
export function visibleDocumentRect({scrollLeft,scrollTop,clientWidth,clientHeight,offsetLeft,offsetTop,zoom,angle=0,docWidth,docHeight}){const c={x:scrollLeft+clientWidth/2-offsetLeft,y:scrollTop+clientHeight/2-offsetTop},rad=angle*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad);let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const [x,y] of [[scrollLeft,scrollTop],[scrollLeft+clientWidth,scrollTop],[scrollLeft+clientWidth,scrollTop+clientHeight],[scrollLeft,scrollTop+clientHeight]]){const dx=x-offsetLeft-c.x,dy=y-offsetTop-c.y,px=(c.x+dx*cs+dy*sn)/zoom,py=(c.y-dx*sn+dy*cs)/zoom;left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}const snap=n=>Math.abs(n-Math.round(n))<1e-6?Math.round(n):n;left=Math.max(0,Math.floor(snap(left)));top=Math.max(0,Math.floor(snap(top)));right=Math.min(docWidth,Math.ceil(snap(right)));bottom=Math.min(docHeight,Math.ceil(snap(bottom)));return{left,top,right,bottom};}
export function drawPixelGrid(ctx,{canvas,frame,zoom,scale,stage,artboard,angle=0}){
  const ratio=window.devicePixelRatio||1,physical=zoom*scale*ratio;if(!showsAt(physical))return;
  const {left,top,right,bottom}=visibleDocumentRect({scrollLeft:stage.scrollLeft,scrollTop:stage.scrollTop,clientWidth:stage.clientWidth,clientHeight:stage.clientHeight,offsetLeft:artboard.offsetLeft,offsetTop:artboard.offsetTop,zoom,angle,docWidth:canvas.width,docHeight:canvas.height});if(right<=left||bottom<=top)return;
  let record=cache.get(canvas);if(!record||record.frame!==frame||record.width!==canvas.width||record.height!==canvas.height||record.left>left||record.top>top||record.right<right||record.bottom<bottom){
    const x=Math.floor(left/64)*64,y=Math.floor(top/64)*64,r=Math.min(canvas.width,Math.ceil(right/64)*64),b=Math.min(canvas.height,Math.ceil(bottom/64)*64),image=canvas.getContext('2d').getImageData(x,y,r-x,b-y);record={frame,width:canvas.width,height:canvas.height,left:x,top:y,right:r,bottom:b,lines:segments(image,x,y)};cache.set(canvas,record);
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();ctx.setLineDash([]);ctx.lineWidth=1/physical;for(const [x,y,r,b,color]of record.lines){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(r,b);ctx.stroke();}ctx.restore();
}
