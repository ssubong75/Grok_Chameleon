// PhotoCraft to_paragraph: a box a little wider than the point text, shifted so center and right alignments stay put.
export function paragraphTextPlan(text,content){
  if(text?.path)throw Error('detach the type layer from its path first');
  if(text?.mode==='paragraph')throw Error('the type layer is already paragraph text');
  const size=Math.max(.1,Number(text?.size)||48),slack=Math.max(4,size*.5),width=Math.max(1,Number(content?.w)||0)+slack,height=Math.max(1,Number(content?.h)||0)+size*.5,align=text?.align||'left';
  let x=Number(text?.x)||0;const y=Number(text?.y)||0;
  if(align==='center'||align==='justifyCenter')x-=width/2;
  else if(align==='right'||align==='justifyRight')x-=width;
  return {mode:'paragraph',boxWidth:width,boxHeight:height,x,y};
}
