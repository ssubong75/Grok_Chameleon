// PhotoCraft doc/src/mode.rs Duotone::render and curve_eval.
export function identityCurve(){return [{input:0,output:0},{input:1,output:1}];}
export function blackDuotone(){return {inks:[{name:'Black',color:[0,0,0],curve:identityCurve()}]};}
function curveEval(points,x){if(!points?.length)return x;if(points.length===1)return points[0].output;if(x<=points[0].input)return points[0].output;for(let i=1;i<points.length;i++){if(x<=points[i].input){const span=Math.max(1e-6,points[i].input-points[i-1].input);return points[i-1].output+(points[i].output-points[i-1].output)*(x-points[i-1].input)/span;}}return points[points.length-1].output;}
export function inkDensity(ink,grayDensity){return Math.max(0,Math.min(1,curveEval(ink.curve,Math.max(0,Math.min(1,grayDensity)))));}
function density(ink,grayDensity){return inkDensity(ink,grayDensity);}
export function renderDuotone(duotone,gray){const inkDensity=1-Math.max(0,Math.min(1,gray));const out=[1,1,1];for(const ink of duotone?.inks||[]){const d=density(ink,inkDensity);for(let c=0;c<3;c++)out[c]*=1-d*(1-(ink.color?.[c]??0));}return out;}
export function defaultDuotoneInks(n){const all=[['Black',[0,0,0]],['Warm Brown',[0.62,0.38,0.18]],['Gold',[0.86,0.68,0.18]],['Slate Blue',[0.27,0.38,0.58]]];return all.slice(0,n).map(([name,color])=>({name,color,curve:identityCurve()}));}
