// PhotoCraft layer.distribute: edge spacing uses doubled coordinates; gaps keep the outer layers.
const EDGES={top:'top',bottom:'bottom',left:'left',right:'right',vcenter:'vcenter',hcenter:'hcenter',topEdges:'top',bottomEdges:'bottom',leftEdges:'left',rightEdges:'right',verticalCenters:'vcenter',horizontalCenters:'hcenter'};
function value2(box,edge){const vertical=edge==='top'||edge==='bottom'||edge==='vcenter',a=vertical?box.y:box.x,b=vertical?a+(vertical?box.h:box.w):box.x+box.w;return edge==='top'||edge==='left'?2*a:edge==='bottom'||edge==='right'?2*b:a+b;}
export function distributeOffsets(boxes,kind){
  if(!boxes||boxes.length<3)throw Error('distributing needs three or more layers with content');
  const gap=kind==='horizontal'||kind==='distributeH'?'x':kind==='vertical'||kind==='distributeV'?'y':null;
  if(gap){const lo=box=>box[gap],hi=box=>box[gap]+(gap==='y'?box.h:box.w),order=boxes.map((box,index)=>({box,index})).sort((a,b)=>(lo(a.box)+hi(a.box))-(lo(b.box)+hi(b.box))||lo(a.box)-lo(b.box)),span=hi(order.at(-1).box)-lo(order[0].box),total=order.reduce((sum,item)=>sum+hi(item.box)-lo(item.box),0),space=(span-total)/(order.length-1);let cursor=lo(order[0].box);const deltas=boxes.map(()=>({dx:0,dy:0}));for(const item of order){const delta=Math.round(cursor)-lo(item.box);deltas[item.index]=gap==='y'?{dx:0,dy:delta}:{dx:delta,dy:0};cursor+=hi(item.box)-lo(item.box)+space;}return deltas;}
  const edge=EDGES[kind];if(!edge)throw Error('unknown kind `'+kind+'`');
  const vertical=edge==='top'||edge==='bottom'||edge==='vcenter',order=boxes.map((box,index)=>({box,index})).sort((a,b)=>value2(a.box,edge)-value2(b.box,edge)),first=value2(order[0].box,edge),last=value2(order.at(-1).box,edge),deltas=boxes.map(()=>({dx:0,dy:0}));
  order.forEach((item,index)=>{const want=first+(last-first)*index/(order.length-1),delta=Math.round((want-value2(item.box,edge))/2);deltas[item.index]=vertical?{dx:0,dy:delta}:{dx:delta,dy:0};});
  return deltas;
}
