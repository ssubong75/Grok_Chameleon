// PhotoCraft to_point: soft wraps become hard returns, and the anchor follows the box alignment.
export function pointTextPlan(text,lines){
  if(text?.path)throw Error('the type layer is path text');
  if(text?.mode!=='paragraph')throw Error('the type layer is already point text');
  const vertical=text.orientation==='vertical',origin=vertical?Number(text.y)||0:Number(text.x)||0,span=vertical?Math.max(1,Number(text.boxHeight)||300):Math.max(1,Number(text.boxWidth)||400),align=text.align||'left';
  let anchor=origin;
  if(align==='center'||align==='justifyCenter')anchor+=span/2;
  else if(align==='right'||align==='justifyRight')anchor+=span;
  const value=(lines?.length?lines:[{value:String(text.value??'')}]).map(line=>line.value??'').join('\n');
  const next={...text,value,mode:'point'};
  if(vertical)next.y=anchor;else next.x=anchor;
  return next;
}
