import {TransformSession} from './transform-session.js';
export class SelectionTransform{
  kind='selection';
  constructor(document){this.document=document;this.free=new TransformSession(document,'free',{kind:'selection'});}
  get drag(){return this.free.drag;}
  set drag(value){this.free.drag=value;}
  begin(point,zoom,event){return this.free.begin(point,zoom,event);}
  move(point,shift,event){this.free.move(point,shift,event);}
  draw(ctx,zoom){this.free.draw(ctx,zoom);}
  release(point){this.free.release?.(point);}
  undoStep(){return this.free.undoStep();}
  redoStep(){return this.free.redoStep();}
  turnBox(kx,ky,angle){return this.free.turnBox(kx,ky,angle);}
  finish(commit){this.free.finish(commit);}
  async editValues(showDialog){const q=this.free.quad,angle=Math.atan2(q[1][1]-q[0][1],q[1][0]-q[0][0])*180/Math.PI;const values=await showDialog('Transform Selection',[{key:'x',label:'X (px)',type:'number',step:'any',value:q[0][0]},{key:'y',label:'Y (px)',type:'number',step:'any',value:q[0][1]},{key:'scaleX',label:'Width (%)',type:'number',step:'any',value:100},{key:'scaleY',label:'Height (%)',type:'number',step:'any',value:100},{key:'angle',label:'Rotation (°)',type:'number',step:'any',value:Math.round(angle*10)/10}]);if(!values)return;const sx=Number(values.scaleX)/100,sy=Number(values.scaleY)/100,nextAngle=(Number(values.angle)-angle)*Math.PI/180;if(![sx,sy,nextAngle].every(Number.isFinite)||!sx||!sy)throw Error('Enter valid selection transform values.');const dx=Number(values.x)-q[0][0],dy=Number(values.y)-q[0][1],cx=(q[0][0]+q[2][0])/2,cy=(q[0][1]+q[2][1])/2,cs=Math.cos(nextAngle),sn=Math.sin(nextAngle);this.free.quad=q.map(p=>{let x=cx+(p[0]-cx)*sx,y=cy+(p[1]-cy)*sy;const rx=x-cx,ry=y-cy;x=cx+rx*cs-ry*sn+dx;y=cy+rx*sn+ry*cs+dy;return [x,y];});this.free.preview();}
}
