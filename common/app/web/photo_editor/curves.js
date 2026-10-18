export const curveKeys=['black','shadows','midtones','highlights','white'];
const positions=[0,64,128,192,255];
export function curveTable(settings){
  const values=curveKeys.map((key,i)=>Math.max(0,Math.min(255,Number(settings[key]??positions[i])))),slopes=[];
  for(let i=0;i<4;i++)slopes.push((values[i+1]-values[i])/(positions[i+1]-positions[i]));
  const tangents=values.map((_,i)=>i===0?slopes[0]:i===4?slopes[3]:slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
  const table=new Uint8ClampedArray(256);let segment=0;
  for(let x=0;x<256;x++){while(segment<3&&x>positions[segment+1])segment++;const span=positions[segment+1]-positions[segment],t=(x-positions[segment])/span,t2=t*t,t3=t2*t;
    table[x]=(2*t3-3*t2+1)*values[segment]+(t3-2*t2+t)*span*tangents[segment]+(-2*t3+3*t2)*values[segment+1]+(t3-t2)*span*tangents[segment+1];}return table;
}
export function attachCurveGraph(container){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.className='curve-graph';canvas.setAttribute('aria-label','Curves: drag a control point to adjust its output');container.prepend(canvas);
  const ctx=canvas.getContext('2d'),inputs=curveKeys.map(key=>container.querySelector(`[name="${key}"]`));
  const draw=()=>{ctx.fillStyle='#343434';ctx.fillRect(0,0,256,256);ctx.strokeStyle='#555';ctx.lineWidth=1;for(let p=0;p<=256;p+=64){ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,256);ctx.moveTo(0,p);ctx.lineTo(256,p);ctx.stroke();}ctx.strokeStyle='#888';ctx.beginPath();ctx.moveTo(0,255);ctx.lineTo(255,0);ctx.stroke();
    const table=curveTable(Object.fromEntries(curveKeys.map((key,i)=>[key,inputs[i].value])));ctx.strokeStyle='#eee';ctx.beginPath();for(let x=0;x<256;x++)x?ctx.lineTo(x,255-table[x]):ctx.moveTo(x,255-table[x]);ctx.stroke();
    ctx.fillStyle='#4db6ff';for(let i=0;i<inputs.length;i++){ctx.beginPath();ctx.arc(positions[i],255-Number(inputs[i].value),4,0,Math.PI*2);ctx.fill();}
  };
  for(const input of inputs)input.addEventListener('input',draw);
  let active=-1;const drag=e=>{if(active<0)return;const rect=canvas.getBoundingClientRect();inputs[active].value=Math.round(Math.max(0,Math.min(255,255-(e.clientY-rect.top)/rect.height*255)));inputs[active].dispatchEvent(new Event('input',{bubbles:true}));};
  canvas.onpointerdown=e=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*255;active=positions.reduce((nearest,p,i)=>Math.abs(p-x)<Math.abs(positions[nearest]-x)?i:nearest,0);canvas.setPointerCapture(e.pointerId);drag(e);};canvas.onpointermove=drag;canvas.onpointerup=()=>{active=-1;};canvas.onpointercancel=()=>{active=-1;};draw();
}
