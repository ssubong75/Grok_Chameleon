// PhotoCraft HdrPreview.apply. Highlight compression is stored and leaves the picture unchanged.
const srgbToLinear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
const linearToSrgb=v=>{const x=Math.max(0,Math.min(1,v));return x<=0.0031308?x*12.92:1.055*x**(1/2.4)-0.055;};
export function hdrPreviewPlan(current,payload={}){
  const next={method:current?.method==='highlightCompression'?'highlightCompression':'exposureGamma',exposure:Number.isFinite(current?.exposure)?current.exposure:0,gamma:Number.isFinite(current?.gamma)?current.gamma:1};
  if(payload.method!=null){const method=String(payload.method);if(method==='exposureGamma'||method==='exposureAndGamma')next.method='exposureGamma';else if(method==='highlightCompression')next.method='highlightCompression';else throw Error('method `'+method+'` (exposureGamma|highlightCompression)');}
  if(payload.exposure!=null){const exposure=Number(payload.exposure);if(Number.isFinite(exposure))next.exposure=Math.min(20,Math.max(-20,exposure));}
  if(payload.gamma!=null){const gamma=Number(payload.gamma);if(Number.isFinite(gamma))next.gamma=Math.min(9.99,Math.max(0.1,gamma));}
  return next;
}
export function hdrPreviewIdentity(preview){return !preview||preview.method==='highlightCompression'||preview.exposure===0&&preview.gamma===1;}
export function hdrPreviewChannel(value,preview){if(hdrPreviewIdentity(preview))return value;const linear=Math.max(0,srgbToLinear(value)*2**preview.exposure);return linearToSrgb(Math.min(1,linear**(1/preview.gamma)));}
