const lum=c=>.3*c[0]+.59*c[1]+.11*c[2];
const sat=c=>Math.max(c[0],c[1],c[2])-Math.min(c[0],c[1],c[2]);
function clipColor(c){const l=lum(c),n=Math.min(c[0],c[1],c[2]),x=Math.max(c[0],c[1],c[2]),out=c.slice();if(n<0){const d=l-n;for(let i=0;i<3;i++)out[i]=l>0&&d>0?l+(out[i]-l)*l/d:l;}if(x>1){const d=x-l;for(let i=0;i<3;i++)out[i]=l<1&&d>0?l+(out[i]-l)*(1-l)/d:l;}return out;}
function setLum(c,l){const d=l-lum(c);return clipColor([c[0]+d,c[1]+d,c[2]+d]);}
function setSat(c,s){const idx=[0,1,2].sort((a,b)=>c[a]-c[b]||a-b),out=[0,0,0];if(c[idx[2]]>c[idx[0]]){out[idx[1]]=(c[idx[1]]-c[idx[0]])*s/(c[idx[2]]-c[idx[0]]);out[idx[2]]=s;}return out;}
export function blendReplace(mode,cb,cs){if(mode==='hue')return setLum(setSat(cs,sat(cb)),lum(cb));if(mode==='saturation')return setLum(setSat(cb,sat(cs)),lum(cb));if(mode==='luminosity')return setLum(cb,lum(cs));return setLum(cs,lum(cb));}
function dabWeight(dx,dy,radius,hardness){const dist=Math.hypot(dx,dy);if(dist>radius)return 0;const solid=radius*Math.max(0,Math.min(1,hardness));if(dist<=solid||radius<=solid)return 1;return (radius-dist)/Math.max(1e-6,radius-solid);}
function rgb(data,i){return [data[i]/255,data[i+1]/255,data[i+2]/255];}
export function applyColorReplacement(image,pre,points,settings,memory){
  const tol=Math.max(0,Math.min(1,settings.tolerance)),soft=settings.antiAlias!==false&&settings.limits!=='findEdges',radius=Math.max(.5,settings.size/2),spacing=Math.max(.5,settings.size*Math.max(.01,settings.spacing||.25));
  const match=d=>d>tol?0:soft&&tol>0?Math.max(0,Math.min(1,(tol-d)/(tol*.25))):1;
  const width=image.width,height=image.height,data=image.data,source=pre.data;
  const stamp=(x,y)=>{
    const cx=Math.floor(x),cy=Math.floor(y);
    let sampled;
    if(settings.sampling==='background')sampled=settings.background;
    else if(settings.sampling==='once'){if(!memory.once){const i=(Math.max(0,Math.min(height-1,cy))*width+Math.max(0,Math.min(width-1,cx)))*4;memory.once=rgb(source,i);}sampled=memory.once;}
    else {const i=(Math.max(0,Math.min(height-1,cy))*width+Math.max(0,Math.min(width-1,cx)))*4;sampled=rgb(source,i);}
    const x0=Math.max(0,Math.floor(x-radius)),y0=Math.max(0,Math.floor(y-radius)),x1=Math.min(width,Math.ceil(x+radius)),y1=Math.min(height,Math.ceil(y+radius));
    if(x1<=x0||y1<=y0)return;const w=x1-x0,h=y1-y0,weight=new Float32Array(w*h);
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){if(dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1)<=0)continue;const i=(py*width+px)*4;if(source[i+3]===0)continue;const color=rgb(source,i),d=Math.max(Math.abs(color[0]-sampled[0]),Math.abs(color[1]-sampled[1]),Math.abs(color[2]-sampled[2]));weight[(py-y0)*w+(px-x0)]=match(d);}
    if(settings.limits!=='discontiguous'){const keep=new Uint8Array(w*h),sx=Math.max(x0,Math.min(x1-1,cx)),sy=Math.max(y0,Math.min(y1-1,cy)),stack=[(sy-y0)*w+(sx-x0)];if(weight[stack[0]]>0){keep[stack[0]]=1;while(stack.length){const i=stack.pop(),px=i%w,py=Math.floor(i/w),near=[];if(px>0)near.push(i-1);if(px+1<w)near.push(i+1);if(py>0)near.push(i-w);if(py+1<h)near.push(i+w);for(const j of near)if(!keep[j]&&weight[j]>0){keep[j]=1;stack.push(j);}}}for(let i=0;i<weight.length;i++)if(!keep[i])weight[i]=0;}
    for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const k=dabWeight(px+.5-x,py+.5-y,radius,settings.hardness??1)*weight[(py-y0)*w+(px-x0)];if(k<=0)continue;const i=(py*width+px)*4,base=rgb(data,i),mixed=blendReplace(settings.mode,base,settings.color);for(let c=0;c<3;c++)data[i+c]=Math.round(Math.max(0,Math.min(1,base[c]+(mixed[c]-base[c])*k))*255);}
  };
  if(!points.length)return memory;let prev=points[0],carry=memory.carry||0;stamp(prev.x,prev.y);
  for(let i=1;i<points.length;i++){const next=points[i],dx=next.x-prev.x,dy=next.y-prev.y,length=Math.hypot(dx,dy);let traveled=spacing-carry;while(traveled<=length){const t=length?traveled/length:1;stamp(prev.x+dx*t,prev.y+dy*t);traveled+=spacing;}carry=length-(traveled-spacing);prev=next;}
  memory.carry=carry;return memory;
}
export function installColorReplacementOptions({state}){
  const bar=document.createElement('span');bar.id='replace-option';bar.hidden=true;
  const select=(key,label,options)=>{const node=document.createElement('select');node.setAttribute('aria-label',label);for(const [value,name] of options){const o=document.createElement('option');o.value=value;o.textContent=name;node.append(o);}node.value=state.colorReplacement[key];node.onchange=()=>{state.colorReplacement[key]=node.value;};bar.append(label+' ',node,' ');};
  state.colorReplacement=state.colorReplacement||{mode:'color',sampling:'continuous',limits:'contiguous',tolerance:30,antiAlias:true};
  select('mode','Mode',[['color','Color'],['hue','Hue'],['saturation','Saturation'],['luminosity','Luminosity']]);
  select('sampling','Sampling',[['continuous','Continuous'],['once','Once'],['background','Background Swatch']]);
  select('limits','Limits',[['contiguous','Contiguous'],['discontiguous','Discontiguous'],['findEdges','Find Edges']]);
  const tolerance=document.createElement('input');tolerance.type='number';tolerance.min='0';tolerance.max='100';tolerance.value='30';tolerance.setAttribute('aria-label','Tolerance');tolerance.onchange=()=>{state.colorReplacement.tolerance=Math.max(0,Math.min(100,Number(tolerance.value)||0));tolerance.value=String(state.colorReplacement.tolerance);};
  const alias=document.createElement('input');alias.type='checkbox';alias.checked=true;alias.setAttribute('aria-label','Anti-alias');alias.onchange=()=>{state.colorReplacement.antiAlias=alias.checked;};
  bar.append('Tolerance ',tolerance,' ',alias,' Anti-alias');document.getElementById('options').append(bar);return bar;
}
