import {copyCanvas,surface} from './engine.js';
import {BezierMesh,splitMesh,warpImage} from './warp-mesh.js';

function snapshot(document,layer){
  return {canvas:copyCanvas(layer.canvas),mask:layer.mask?copyCanvas(layer.mask):null,vectorMask:layer.vectorMask?structuredClone(layer.vectorMask):null,x:layer.x,y:layer.y,maskOffsetX:layer.maskOffsetX||0,maskOffsetY:layer.maskOffsetY||0,text:layer.text?structuredClone(layer.text):null,shape:layer.shape?structuredClone(layer.shape):null,dirty:document.dirty};
}
function restore(document,layer,base){
  Object.assign(layer,{canvas:copyCanvas(base.canvas),mask:base.mask?copyCanvas(base.mask):null,vectorMask:base.vectorMask?structuredClone(base.vectorMask):null,x:base.x,y:base.y,maskOffsetX:base.maskOffsetX,maskOffsetY:base.maskOffsetY,text:base.text?structuredClone(base.text):null,shape:base.shape?structuredClone(base.shape):null});
  document.dirty=base.dirty;
}
function read(canvas){return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);}
function putImage(result){const canvas=surface(result.width,result.height);canvas.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);return canvas;}

export class DistortTransform{
  constructor(document){
    this.kind='distort';this.document=document;this.layer=document.active;this.original=snapshot(document,this.layer);this.drag=null;
    const {x,y,canvas}=this.layer;this.corners=[{x,y},{x:x+canvas.width,y},{x:x+canvas.width,y:y+canvas.height},{x,y:y+canvas.height}];this.base=this.corners.map(p=>({...p}));
  }
  restore(){restore(this.document,this.layer,this.original);}
  get changed(){return this.corners.some((point,index)=>point.x!==this.base[index].x||point.y!==this.base[index].y);}
  handles(){return this.corners.map((point,index)=>[index,point.x,point.y]);}
  draw(ctx,zoom){
    const c=this.corners;ctx.save();ctx.strokeStyle='#4db6ff';ctx.fillStyle='#fff';ctx.lineWidth=1/zoom;ctx.beginPath();ctx.moveTo(c[0].x,c[0].y);for(const point of c.slice(1))ctx.lineTo(point.x,point.y);ctx.closePath();ctx.stroke();
    for(const [,x,y] of this.handles()){ctx.fillRect(x-3/zoom,y-3/zoom,6/zoom,6/zoom);ctx.strokeRect(x-3/zoom,y-3/zoom,6/zoom,6/zoom);}ctx.restore();
  }
  inside(point){const c=this.corners;let hit=false;for(let i=0,j=3;i<4;j=i++){const a=c[i],b=c[j];if((a.y>point.y)!==(b.y>point.y)&&(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x))hit=!hit;}return hit;}
  begin(point,zoom){
    const hit=this.handles().find(([,x,y])=>Math.hypot(x-point.x,y-point.y)<9/zoom);
    if(!hit&&!this.inside(point))return false;
    this.drag={index:hit?hit[0]:'move',start:point,corners:this.corners.map(p=>({...p}))};return true;
  }
  preview(corners){this.restore();this.document.perspectiveLayer(corners,false);}
  move(point){
    const drag=this.drag;if(!drag)return;const dx=point.x-drag.start.x,dy=point.y-drag.start.y;
    const next=drag.corners.map((corner,index)=>drag.index==='move'||drag.index===index?{x:corner.x+dx,y:corner.y+dy}:{...corner});
    try{this.preview(next);this.corners=next;}catch{try{this.preview(this.corners);}catch{this.restore();}}
  }
  finish(commit){
    if(!this.document.layers.includes(this.layer)){this.drag=null;return;}
    this.restore();
    if(commit&&this.changed){this.document.checkpoint('Distort');this.document.perspectiveLayer(this.corners,false);}
    else this.document.dispatchEvent(new Event('change'));
    this.drag=null;
  }
}

export class WarpTransform{
  constructor(document){
    this.kind='warp';this.document=document;this.layer=document.active;this.original=snapshot(document,this.layer);this.drag=null;
    const {x,y,canvas}=this.layer;this.mesh=BezierMesh.identity([x,y,x+canvas.width,y+canvas.height]);this.initial=this.mesh.points.map(p=>p.slice());
  }
  restore(){restore(this.document,this.layer,this.original);}
  get changed(){return this.mesh.points.some((point,index)=>point[0]!==this.initial[index][0]||point[1]!==this.initial[index][1])||this.mesh.us.length!==2||this.mesh.vs.length!==2;}
  anchors(){const nx=this.mesh.nx(),out=[];for(let j=0;j<this.mesh.ny();j+=3)for(let i=0;i<nx;i+=3){const p=this.mesh.points[j*nx+i];out.push({index:j*nx+i,x:p[0],y:p[1]});}return out;}
  draw(ctx,zoom){
    const mesh=this.mesh,steps=24;ctx.save();ctx.strokeStyle='#4db6ff';ctx.fillStyle='#fff';ctx.lineWidth=1/zoom;
    const line=(at)=>{ctx.beginPath();for(let i=0;i<=steps;i++){const p=at(i/steps);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);}ctx.stroke();};
    const knotsU=mesh.us.length===2?[0,1/3,2/3,1]:mesh.us,knotsV=mesh.vs.length===2?[0,1/3,2/3,1]:mesh.vs;
    ctx.setLineDash(mesh.us.length===2?[4/zoom,3/zoom]:[]);for(const u of knotsU)if(mesh.us.length>2||u!==0&&u!==1)line(t=>mesh.eval(u,t));
    for(const v of knotsV)if(mesh.vs.length>2||v!==0&&v!==1)line(s=>mesh.eval(s,v));
    ctx.setLineDash([]);line(t=>mesh.eval(0,t));line(t=>mesh.eval(1,t));line(s=>mesh.eval(s,0));line(s=>mesh.eval(s,1));
    for(const point of this.anchors()){ctx.fillRect(point.x-3/zoom,point.y-3/zoom,6/zoom,6/zoom);ctx.strokeRect(point.x-3/zoom,point.y-3/zoom,6/zoom,6/zoom);}ctx.restore();
  }
  begin(point,zoom){
    const hit=this.anchors().find(item=>Math.hypot(item.x-point.x,item.y-point.y)<9/zoom);
    const [s,t]=this.mesh.paramAt([point.x,point.y]),near=this.mesh.eval(s,t);
    if(!hit&&Math.hypot(near[0]-point.x,near[1]-point.y)>12/zoom)return false;
    this.drag={kind:hit?'point':'pull',index:hit?.index,s,t,start:point,base:this.mesh.points.map(p=>p.slice())};return true;
  }
  cell(){const area=this.original.canvas.width*this.original.canvas.height;return area>1500000?16:area>400000?8:4;}
  paint(cell){
    this.restore();
    const image=read(this.layer.canvas),result=warpImage(image,this.mesh,cell),canvas=putImage(result);
    const linked=this.layer.mask&&this.layer.maskLinked!==false,maskImage=linked?read(this.document.alignedMask(this.layer)):null,maskResult=maskImage?warpImage(maskImage,this.mesh,cell):null;
    this.layer.canvas=canvas;this.layer.x=result.x;this.layer.y=result.y;this.layer.text=null;this.layer.shape=null;
    if(maskResult){this.layer.mask=putImage(maskResult);this.layer.maskOffsetX=maskResult.x-result.x;this.layer.maskOffsetY=maskResult.y-result.y;}
    else if(this.layer.mask){this.layer.maskOffsetX=(this.original.maskOffsetX||0)+(this.original.x-result.x);this.layer.maskOffsetY=(this.original.maskOffsetY||0)+(this.original.y-result.y);}
    this.document.dispatchEvent(new Event('change'));
  }
  move(point){
    const drag=this.drag;if(!drag)return;const delta=[point.x-drag.start.x,point.y-drag.start.y];
    if(drag.kind==='point')this.mesh.dragPoint(drag.base,drag.index,delta);else this.mesh.pull(drag.base,drag.s,drag.t,delta);
    try{this.paint(this.cell());}catch{this.restore();this.document.dispatchEvent(new Event('change'));}
  }
  split(how){this.drag=null;if(!splitMesh(this.mesh,how))return false;try{this.paint(this.cell());}catch{this.restore();}return true;}
  finish(commit){
    if(!this.document.layers.includes(this.layer)){this.drag=null;return;}
    this.restore();
    if(commit&&this.changed){this.document.checkpoint('Warp');this.paint(4);this.document.dirty=true;}
    else this.document.dispatchEvent(new Event('change'));
    this.drag=null;
  }
}
