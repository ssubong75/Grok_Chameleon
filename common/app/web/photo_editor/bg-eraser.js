function dabWeight(dx,dy,radius,hardness){const dist=Math.hypot(dx,dy);if(dist>radius)return 0;const solid=radius*Math.max(0,Math.min(1,hardness));if(dist<=solid||radius<=solid)return 1;return (radius-dist)/Math.max(1e-6,radius-solid);}
const rgb=data=>i=>[data[i]/255,data[i+1]/255,data[i+2]/255];
const dist=(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
export function applyBackgroundEraser(image,pre,points,settings,memory){
  const tol=Number.isFinite(settings.tolerance)?Math.max(0,Math.min(1,settings.tolerance)):0,soft=settings.limits!=='findEdges',radius=Math.max(.5,settings.size/2),spacing=Math.max(.5,settings.size*Math.max(.01,settings.spacing||.25));
  const match=d=>d>tol?0:soft&&tol>0?Math.max(0,Math.min(1,(tol-d)/(tol*.25))):1;
  const width=image.width,height=image.height,data=image.data,source=pre.data,color=rgb(source);
  const stamp=(x,y)=>{
    const cx=Math.floor(x),cy=Math.floor(y),inside=cx>=0&&cy>=0&&cx<width&&cy<height,hot=()=>inside&&source[(cy*width+cx)*4+3]>0?color((cy*width+cx)*4):null;
    let sampled;if(settings.sampling==='background')sampled=settings.background;else if(settings.sampling==='once'){if(memory.once===undefined)memory.once=hot();sampled=memory.once;}else sampled=hot();
    if(!sampled)return;const x0=Math.max(0,Math.floor(x-radius)),y0=Math.max(0,Math.floor(y-radius)),x1=Math.min(width,Math.ceil(x+radius)),y1=Math.min(height,Math.ceil(y+radius));if(x1<=x0||y1<=y0)return;
    const w=x1-x0,h=y1-y0,weight=new Float32Array(w*h);
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){if(dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1)<=0)continue;const i=(py*width+px)*4;if(source[i+3]===0)continue;const pixel=color(i);if(settings.protectForeground&&dist(pixel,settings.foreground)<=tol)continue;weight[(py-y0)*w+(px-x0)]=match(dist(pixel,sampled));}
    if(settings.limits!=='discontiguous'){const keep=new Uint8Array(w*h),sx=Math.max(x0,Math.min(x1-1,cx)),sy=Math.max(y0,Math.min(y1-1,cy)),stack=[(sy-y0)*w+(sx-x0)];if(weight[stack[0]]>0){keep[stack[0]]=1;while(stack.length){const i=stack.pop(),px=i%w,py=Math.floor(i/w),near=[];if(px>0)near.push(i-1);if(px+1<w)near.push(i+1);if(py>0)near.push(i-w);if(py+1<h)near.push(i+w);for(const j of near)if(!keep[j]&&weight[j]>0){keep[j]=1;stack.push(j);}}}for(let i=0;i<weight.length;i++)if(!keep[i])weight[i]=0;}
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const k=Math.min(1,dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1)*weight[(py-y0)*w+(px-x0)]);if(k<=0)continue;const i=(py*width+px)*4,alpha=data[i+3]*(1-k);data[i+3]=Math.round(alpha);if(data[i+3]===0)data[i]=data[i+1]=data[i+2]=0;}
  };
  if(!points.length)return memory;let prev=points[0],carry=memory.carry||0;stamp(prev.x,prev.y);
  for(let i=1;i<points.length;i++){const next=points[i],dx=next.x-prev.x,dy=next.y-prev.y,length=Math.hypot(dx,dy);let traveled=spacing-carry;while(traveled<=length){const t=length?traveled/length:1;stamp(prev.x+dx*t,prev.y+dy*t);traveled+=spacing;}carry=length-(traveled-spacing);prev=next;}
  memory.carry=carry;return memory;
}
export function installBackgroundEraserOptions({state}){
  const bar=document.createElement('span');bar.id='bg-eraser-option';bar.hidden=true;
  const select=(key,label,options)=>{const node=document.createElement('select');node.setAttribute('aria-label',label);for(const [value,name] of options){const o=document.createElement('option');o.value=value;o.textContent=name;node.append(o);}node.value=state.backgroundEraser[key];node.onchange=()=>{state.backgroundEraser[key]=node.value;};bar.append(label+' ',node,' ');};
  state.backgroundEraser=state.backgroundEraser||{sampling:'continuous',limits:'contiguous',tolerance:50,protectForeground:false};
  select('sampling','Sampling',[['continuous','Continuous'],['once','Once'],['background','Background Swatch']]);
  select('limits','Limits',[['contiguous','Contiguous'],['discontiguous','Discontiguous'],['findEdges','Find Edges']]);
  const tolerance=document.createElement('input');tolerance.type='number';tolerance.min='0';tolerance.max='100';tolerance.value='50';tolerance.setAttribute('aria-label','Tolerance');tolerance.onchange=()=>{state.backgroundEraser.tolerance=Math.max(0,Math.min(100,Number(tolerance.value)||0));tolerance.value=String(state.backgroundEraser.tolerance);};
  const protect=document.createElement('input');protect.type='checkbox';protect.setAttribute('aria-label','Protect Foreground Color');protect.onchange=()=>{state.backgroundEraser.protectForeground=protect.checked;};
  bar.append('Tolerance ',tolerance,' ',protect,' Protect Foreground Color');document.getElementById('options').append(bar);return bar;
}
