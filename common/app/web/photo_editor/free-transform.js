import {copyCanvas} from './engine.js';
export class FreeTransform{
  constructor(document,{interpolation='bicubicAutomatic',mode='free'}={}){this.document=document;this.layer=document.active;this.mode=mode;const layer=this.layer;
    this.original={canvas:copyCanvas(layer.canvas),mask:layer.mask?copyCanvas(layer.mask):null,vectorMask:layer.vectorMask?structuredClone(layer.vectorMask):null,x:layer.x,y:layer.y,maskOffsetX:layer.maskOffsetX||0,maskOffsetY:layer.maskOffsetY||0,text:layer.text?structuredClone(layer.text):null,shape:layer.shape?structuredClone(layer.shape):null,dirty:document.dirty};
    this.settings={x:layer.x,y:layer.y,scaleX:1,scaleY:1,angle:0,interpolation};this.drag=null;
  }
  restore(){const base=this.original;Object.assign(this.layer,{canvas:copyCanvas(base.canvas),mask:base.mask?copyCanvas(base.mask):null,vectorMask:base.vectorMask?structuredClone(base.vectorMask):null,x:base.x,y:base.y,maskOffsetX:base.maskOffsetX,maskOffsetY:base.maskOffsetY,text:base.text,shape:base.shape});this.document.dirty=base.dirty;}
  apply(settings,record=false){const d=this.document;if(!d.layers.includes(this.layer))return;const previous=d.activeId;d.activeId=this.layer.id;try{d.transformLayer(settings,record);}finally{d.activeId=previous;}}
  get changed(){return ['x','y'].some(key=>this.settings[key]!==this.original[key])||this.settings.scaleX!==1||this.settings.scaleY!==1||this.settings.angle!==0||Boolean(this.settings.skewX)||Boolean(this.settings.skewY);}
  handles(zoom){const {x,y,canvas}=this.layer,w=canvas.width,h=canvas.height;return[['nw',x,y],['n',x+w/2,y],['ne',x+w,y],['e',x+w,y+h/2],['se',x+w,y+h],['s',x+w/2,y+h],['sw',x,y+h],['w',x,y+h/2],['rotate',x+w/2,y-24/zoom]];}
  draw(ctx,zoom){const layer=this.layer;ctx.save();ctx.strokeStyle='#4db6ff';ctx.fillStyle='#fff';ctx.lineWidth=1/zoom;ctx.setLineDash([]);ctx.strokeRect(layer.x,layer.y,layer.canvas.width,layer.canvas.height);ctx.beginPath();ctx.moveTo(layer.x+layer.canvas.width/2,layer.y);ctx.lineTo(layer.x+layer.canvas.width/2,layer.y-24/zoom);ctx.stroke();for(const [name,x,y]of this.handles(zoom)){if(name==='rotate'){ctx.beginPath();ctx.arc(x,y,4/zoom,0,Math.PI*2);ctx.fill();ctx.stroke();}else{ctx.fillRect(x-3/zoom,y-3/zoom,6/zoom,6/zoom);ctx.strokeRect(x-3/zoom,y-3/zoom,6/zoom,6/zoom);}}ctx.restore();}
  begin(point,zoom){const hit=this.handles(zoom).find(([,x,y])=>Math.hypot(x-point.x,y-point.y)<9/zoom);const layer=this.layer;
    const inside=point.x>=layer.x&&point.x<=layer.x+layer.canvas.width&&point.y>=layer.y&&point.y<=layer.y+layer.canvas.height;if(!hit&&!inside)return false;
    this.drag={handle:hit?.[0]||'move',start:point,settings:{...this.settings},bounds:{x:layer.x,y:layer.y,w:layer.canvas.width,h:layer.canvas.height},center:{x:this.settings.x+this.original.canvas.width/2,y:this.settings.y+this.original.canvas.height/2}};return true;
  }
  move(point,shift=false){const drag=this.drag;if(!drag)return;const next={...drag.settings},dx=point.x-drag.start.x,dy=point.y-drag.start.y,b=drag.bounds;
    if(drag.handle==='move'){next.x+=dx;next.y+=dy;}
    else if(this.mode==='skew'&&'nsew'.includes(drag.handle)){const shear=drag.handle==='n'||drag.handle==='s'?dx/b.h*90:dy/b.w*90;if(drag.handle==='n'||drag.handle==='s')next.skewX=(drag.settings.skewX||0)+shear;else next.skewY=(drag.settings.skewY||0)+shear;}
    else if(drag.handle==='rotate'){const pivot=drag.center,delta=(Math.atan2(point.y-pivot.y,point.x-pivot.x)-Math.atan2(drag.start.y-pivot.y,drag.start.x-pivot.x))*180/Math.PI;next.angle=drag.settings.angle+delta;if(shift)next.angle=Math.round(next.angle/15)*15;}
    else{let left=b.x,right=b.x+b.w,top=b.y,bottom=b.y+b.h;if(drag.handle.includes('w'))left=Math.min(right-1,left+dx);if(drag.handle.includes('e'))right=Math.max(left+1,right+dx);if(drag.handle.includes('n'))top=Math.min(bottom-1,top+dy);if(drag.handle.includes('s'))bottom=Math.max(top+1,bottom+dy);
      let sx=(right-left)/b.w,sy=(bottom-top)/b.h;if(shift){const ratio=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;sx=sy=ratio;if(drag.handle.includes('w'))left=right-b.w*ratio;else right=left+b.w*ratio;if(drag.handle.includes('n'))top=bottom-b.h*ratio;else bottom=top+b.h*ratio;}
      next.scaleX*=sx;next.scaleY*=sy;next.x+=(left+right)/2-(b.x+b.w/2);next.y+=(top+bottom)/2-(b.y+b.h/2);
    }
    this.restore();this.settings=next;try{this.apply(next);}catch(error){this.settings={...drag.settings};this.restore();this.apply(this.settings);throw error;}
  }
  finish(commit,{record=true}={}){if(!this.document.layers.includes(this.layer)){this.drag=null;return;}this.restore();if(commit&&this.changed){this.apply(this.settings,record);this.document.lastTransform={...this.settings};}this.document.dispatchEvent(new Event('change'));this.drag=null;}
}
