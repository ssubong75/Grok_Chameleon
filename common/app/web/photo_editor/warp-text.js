// PhotoCraft type.warpText: style defaults to arc, bend to 50, distortions to 0, orientation horizontal.
const STYLES=new Set(['none','arc','arcLower','arcUpper','arch','bulge','shellLower','shellUpper','flag','wave','fish','rise','fisheye','inflate','squeeze','twist']);
const clamp=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(-100,Math.min(100,n)):0;};
export function warpTextPlan(text,options={}){
  const style=options.style==null?'arc':String(options.style);
  if(!STYLES.has(style))throw Error('unknown warp style "'+style+'"');
  if(style==='none')return {...text,warpStyle:'none',warpBend:0,warpHorizontal:0,warpVertical:0,warpAxis:'horizontal'};
  return {...text,warpStyle:style,warpBend:options.bend==null?50:clamp(options.bend),warpHorizontal:options.horizontalDistortion==null?0:clamp(options.horizontalDistortion),warpVertical:options.verticalDistortion==null?0:clamp(options.verticalDistortion),warpAxis:options.orientation==='vertical'?'vertical':'horizontal'};
}
