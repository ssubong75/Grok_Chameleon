const CLICK_PX=3,HANDLE_PX=6,GAP=100,I32_MIN=-2147483648,I32_MAX=2147483647;
export const artboardPresets=[['iPhone 14',390,844],['iPhone 14 Pro Max',430,932],['Android 1080p',360,640],['iPad Pro 12.9',1024,1366],['Web 1280',1280,800],['Web 1366',1366,768],['Web 1920',1920,1080],['Instagram Post',1080,1080],['Letter',612,792],['A4',595,842]];
function roundInt(value){const n=Number(value);if(!Number.isFinite(n))return null;return Math.round(n);}
function boardRect(x,y,w,h){if(!(w>0)||!(h>0))throw Error('the artboard size must be positive (width = '+w+', height = '+h+')');if([x,y,x+w,y+h].some(n=>n<I32_MIN||n>I32_MAX))throw Error('the artboard [x, y, width, height] = ['+x+', '+y+', '+w+', '+h+'] reaches outside the 32-bit coordinate range ('+I32_MIN+'..='+I32_MAX+')');return {x,y,w,h};}
export function planNewArtboard(doc,params={}){const preset=typeof params.preset==='string'?params.preset:'';let pw=doc.width,ph=doc.height;if(preset){const found=artboardPresets.find(item=>item[0].toLowerCase()===preset.toLowerCase());if(!found)throw Error('unknown preset `'+preset+'`');pw=found[1];ph=found[2];}const boards=(doc.layers||[]).filter(layer=>layer.artboard);let right=null,top=null;for(const layer of boards){const edge=layer.artboard.x+layer.artboard.w;right=right==null?edge:Math.max(right,edge);top=top==null?layer.artboard.y:Math.min(top,layer.artboard.y);}const baseX=right==null?0:right+GAP,baseY=top==null?0:top,explicit=params.rect!=null||params.x!=null;if(right!=null&&!explicit&&baseX>I32_MAX)throw Error('no room for a new artboard right of the rightmost one (its right edge is x = '+right+'); pass "x" to place it');let x,y,w,h;if(Array.isArray(params.rect)){if(params.rect.length!==4||params.rect.some(value=>roundInt(value)==null))throw Error('"rect" must be [x, y, width, height] with a positive size');[x,y,w,h]=params.rect.map(roundInt);}else if(preset){x=params.x==null?baseX:roundInt(params.x);y=params.y==null?baseY:roundInt(params.y);w=pw;h=ph;}else{x=params.x==null?baseX:roundInt(params.x);y=params.y==null?baseY:roundInt(params.y);w=params.width==null?pw:roundInt(params.width);h=params.height==null?ph:roundInt(params.height);}if([x,y,w,h].some(n=>n==null))throw Error('the artboard size must be positive (width = '+w+', height = '+h+')');const rect=boardRect(x,y,w,h);const background=params.background||'white';if(!['white','black','transparent'].includes(background))throw Error('unknown background `'+background+'` (white|black|transparent)');const names=boards.map(layer=>layer.name);let n=1;while(names.includes('Artboard '+n))n++;const name=typeof params.name==='string'&&params.name?params.name:'Artboard '+n;return {...rect,background,name,preset};}
function contentBox(doc,layer){if(layer.kind==='group'){let box=null;for(const child of (doc.layers||[]).filter(item=>item.parentId===layer.id)){const next=contentBox(doc,child);if(!next)continue;if(!box)box=next;else{const x1=Math.max(box.x+box.w,next.x+next.w),y1=Math.max(box.y+box.h,next.y+next.h);box={x:Math.min(box.x,next.x),y:Math.min(box.y,next.y),w:x1-Math.min(box.x,next.x),h:y1-Math.min(box.y,next.y)};}}return box;}if(!layer.canvas||layer.kind==='adjustment')return null;return {x:Math.round(layer.x||0),y:Math.round(layer.y||0),w:layer.canvas.width,h:layer.canvas.height};}
export function artboardFromGroup(doc,layer,params={}){if(!layer||layer.kind!=='group'||layer.artboard||layer.parentId)throw Error('artboards are made from a top-level layer group');const background=params.background||'white';if(!['white','black','transparent'].includes(background))throw Error('unknown background `'+background+'` (white|black|transparent)');const box=contentBox(doc,layer)||{x:0,y:0,w:doc.width,h:doc.height};return {...box,background};}
function insideArtboard(doc,layer){const seen=new Set();let current=layer;while(current&&!seen.has(current.id)){if(current.artboard)return true;seen.add(current.id);current=(doc.layers||[]).find(item=>item.id===current.parentId);}return false;}
export function artboardFromLayers(doc,roots,params={}){if(!roots?.length||roots.some(layer=>insideArtboard(doc,layer)))throw Error('select layers that are not in an artboard');const background=params.background||'white';if(!['white','black','transparent'].includes(background))throw Error('unknown background `'+background+'` (white|black|transparent)');let box=null;for(const layer of roots){const next=contentBox(doc,layer);if(!next)continue;if(!box)box=next;else{const x=Math.min(box.x,next.x),y=Math.min(box.y,next.y),x1=Math.max(box.x+box.w,next.x+next.w),y1=Math.max(box.y+box.h,next.y+next.h);box={x,y,w:x1-x,h:y1-y};}}box=box||{x:0,y:0,w:doc.width,h:doc.height};const names=(doc.layers||[]).filter(layer=>layer.artboard).map(layer=>layer.name);let n=1;while(names.includes('Artboard '+n))n++;const name=typeof params.name==='string'&&params.name?params.name:'Artboard '+n;return {...box,background,name,ids:roots.map(layer=>layer.id)};}
const sat=n=>Math.max(-2147483648,Math.min(2147483647,Math.trunc(n)));
export function artboardRecord(value){
  if(value==null)return null;
  const background=value.background==='black'||value.background==='transparent'?value.background:'white';
  if(value.background!=null&&background!==value.background)return null;
  const {x,y,w,h}=value;
  if(![x,y,w,h].every(Number.isInteger)||w<1||h<1||w>32767||h>32767)return null;
  return{x,y,w,h,background};
}
export function drawnBoard(start,cur){const x0=sat(Math.round(Math.min(start.x,cur.x))),y0=sat(Math.round(Math.min(start.y,cur.y))),x1=sat(Math.round(Math.max(start.x,cur.x))),y1=sat(Math.round(Math.max(start.y,cur.y)));return{x:x0,y:y0,w:x1-x0,h:y1-y0};}
export function movedBoard(rect,start,cur){const dx=sat(Math.round(cur.x-start.x)),dy=sat(Math.round(cur.y-start.y));return{x:sat(rect.x+dx),y:sat(rect.y+dy),w:rect.w,h:rect.h};}
function resized(edges,hx,hy,d){const e=edges.slice();for(const [h,lo,hi,dv] of [[hx,0,2,d[0]],[hy,1,3,d[1]]]){if(h===-1)e[lo]=sat(e[lo]+dv);else if(h===1)e[hi]=sat(e[hi]+dv);const a=Math.min(e[lo],e[hi]),b=Math.max(e[lo],e[hi]);e[lo]=a;e[hi]=Math.max(b,sat(a+1));}return e;}
function resizedKeep(edges,hx,hy,d){const w=Math.max(1,edges[2]-edges[0]),h=Math.max(1,edges[3]-edges[1]),ax=hx>0?edges[0]:edges[2],ay=hy>0?edges[1]:edges[3],cx=sat((hx>0?edges[2]:edges[0])+d[0]),cy=sat((hy>0?edges[3]:edges[1])+d[1]),dw=cx-ax,dh=cy-ay,k=Math.max(Math.abs(dw)/w,Math.abs(dh)/h),nw=Math.max(1,Math.round(w*k)),nh=Math.max(1,Math.round(h*k));const span=(a,len,toward)=>toward<0?[sat(a-len),a]:[a,sat(a+len)];const [x0,x1]=span(ax,nw,dw),[y0,y1]=span(ay,nh,dh);return[Math.min(x0,x1),Math.min(y0,y1),Math.max(x0,x1),Math.max(y0,y1)];}
export function resizedBoard(rect,hx,hy,start,cur,keep){const d=[sat(Math.round(cur.x-start.x)),sat(Math.round(cur.y-start.y))],edges=[rect.x,rect.y,rect.x+rect.w,rect.y+rect.h],next=keep&&hx&&hy?resizedKeep(edges,hx,hy,d):resized(edges,hx,hy,d);return{x:next[0],y:next[1],w:next[2]-next[0],h:next[3]-next[1]};}
export function screenDrag(start,cur,zoom){return Math.hypot(cur.x-start.x,cur.y-start.y)*Math.max(.01,zoom);}
export function artboardToFit(doc){
  const layers=doc?.layers||[],byId=id=>layers.find(layer=>layer.id===id);
  const rootOf=layer=>{const seen=new Set();let current=layer;while(current&&!seen.has(current.id)){seen.add(current.id);if(!current.parentId)return current;current=byId(current.parentId);}return null;};
  const root=rootOf(byId(doc?.activeId));
  if(root?.artboard)return root;
  for(let i=layers.length-1;i>=0;i--)if(layers[i].artboard)return layers[i];
  return null;
}
export function fitArtboardPlan(board,areaWidth,areaHeight){
  if(!board)throw Error('the document has no artboards');
  const wide=areaWidth>50,w=wide?areaWidth:1200,h=wide?areaHeight:800;
  return {zoom:Math.min((w-60)/Math.max(1,board.w),(h-80)/Math.max(1,board.h)),center:[board.x+board.w/2,board.y+board.h/2],bounds:[board.x,board.y,board.x+board.w,board.y+board.h]};
}
export function selectedArtboard(doc){
  const layers=doc?.layers||[],byId=id=>layers.find(layer=>layer.id===id),seen=new Set();
  let current=byId(doc?.activeId);
  while(current&&!seen.has(current.id)){seen.add(current.id);if(!current.parentId)return current.artboard?current:null;current=byId(current.parentId);}
  return null;
}
export function guideInside(board,guide){return guide.axis==='vertical'?guide.position>board.x&&guide.position<board.x+board.w:guide.position>board.y&&guide.position<board.y+board.h;}
export function clearArtboardGuides(guides,board){
  if(!board)throw Error('no artboard selected');
  const kept=[];let cleared=0;
  for(const guide of guides||[])if(guideInside(board,guide))cleared++;else kept.push(guide);
  return {guides:kept,cleared};
}
export function clearCanvasGuides(guides,boards){
  const list=boards||[],kept=[];let cleared=0;
  for(const guide of guides||[])if(list.some(board=>guideInside(board,guide)))kept.push(guide);else cleared++;
  return {guides:kept,cleared};
}
export function boardAt(layers,p){for(let i=layers.length-1;i>=0;i--){const layer=layers[i],b=layer.artboard;if(!b||p.x<b.x||p.y<b.y||p.x>=b.x+b.w||p.y>=b.y+b.h)continue;return layer;}return null;}
export function handleAt(board,p,zoom){if(!board?.artboard)return null;const tol=HANDLE_PX/Math.max(.01,zoom),r=board.artboard,points=[[-1,-1,r.x,r.y],[0,-1,r.x+r.w/2,r.y],[1,-1,r.x+r.w,r.y],[-1,0,r.x,r.y+r.h/2],[1,0,r.x+r.w,r.y+r.h/2],[-1,1,r.x,r.y+r.h],[0,1,r.x+r.w/2,r.y+r.h],[1,1,r.x+r.w,r.y+r.h]];for(const [hx,hy,x,y] of points)if(Math.hypot(p.x-x,p.y-y)<=tol)return{hx,hy};return null;}
export function installArtboardTool({overlay,state,getDocument,point,draw,message}){
  let drag=null;
  const preview=()=>!drag?null:drag.kind==='new'?drawnBoard(drag.start,drag.cur):drag.kind==='move'?movedBoard(drag.rect,drag.start,drag.cur):resizedBoard(drag.rect,drag.hx,drag.hy,drag.start,drag.cur,drag.keep);
  overlay.addEventListener('pointerdown',e=>{if(e.button!==0||(state.activeTool||state.tool)!=='artboard'||!getDocument())return;const d=getDocument(),p=point(e),active=d.layers.find(layer=>layer.id===d.activeId),hit=active?.artboard?handleAt(active,p,state.zoom):null,board=boardAt(d.layers,p);drag=hit?{kind:'resize',layer:active,rect:{...active.artboard},hx:hit.hx,hy:hit.hy,start:p,cur:p,keep:e.shiftKey}:board?{kind:'move',layer:board,rect:{...board.artboard},start:p,cur:p}:{kind:'new',start:p,cur:p};if(board&&!hit&&d.activeId!==board.id){d.activeId=board.id;d.selectedLayerIds=[board.id];d.changed();}state.gesture={tool:'artboard'};overlay.setPointerCapture(e.pointerId);e.stopImmediatePropagation();draw();},true);
  overlay.addEventListener('pointermove',e=>{if(!drag)return;drag.cur=point(e);if(drag.kind==='resize')drag.keep=e.shiftKey;e.stopImmediatePropagation();draw();},true);
  const finish=e=>{if(!drag)return;if(e)drag.cur=point(e);const d=getDocument(),next=preview(),kind=drag.kind,layer=drag.layer,screen=screenDrag(drag.start,drag.cur,state.zoom);drag=null;state.gesture=null;e?.stopImmediatePropagation();try{if(!d||!next)return;if(kind==='new'){if(screen<CLICK_PX||next.w<1||next.h<1)return;d.addArtboard(next);}else if(kind==='move'&&layer.artboard&&(next.x!==layer.artboard.x||next.y!==layer.artboard.y))d.moveArtboard(layer,next.x,next.y);else if(kind==='resize'&&layer.artboard&&(next.x!==layer.artboard.x||next.y!==layer.artboard.y||next.w!==layer.artboard.w||next.h!==layer.artboard.h))d.resizeArtboard(layer,next);}catch(error){message(error.message);}draw();};
  overlay.addEventListener('pointerup',finish,true);overlay.addEventListener('pointercancel',()=>{drag=null;state.gesture=null;},true);
  return{draw(ctx){if((state.activeTool||state.tool)!=='artboard')return;const d=getDocument();if(!d)return;const box=preview(),active=d.layers.find(layer=>layer.id===d.activeId),shown=box||active?.artboard;if(!shown)return;ctx.save();ctx.strokeStyle='#4da3ff';ctx.lineWidth=1/Math.max(.01,state.zoom);ctx.strokeRect(shown.x,shown.y,shown.w,shown.h);if(!box&&active?.artboard){const r=active.artboard,s=4/Math.max(.01,state.zoom);ctx.fillStyle='#4da3ff';for(const [x,y] of [[r.x,r.y],[r.x+r.w/2,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h/2],[r.x+r.w,r.y+r.h/2],[r.x,r.y+r.h],[r.x+r.w/2,r.y+r.h],[r.x+r.w,r.y+r.h]])ctx.fillRect(x-s/2,y-s/2,s,s);}ctx.restore();},cancel(){drag=null;if(state.gesture?.tool==='artboard')state.gesture=null;}};
}
