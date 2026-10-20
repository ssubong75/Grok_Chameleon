import {wandCoverage} from './selection-wand.js';
import {transformPath} from './paths.js';
// Binary selections store scanline spans, so project history remains cloneable.
export function offsetSelection(selection,dx,dy){
  if(!selection)return null;const next=structuredClone(selection);next.x+=dx;next.y+=dy;
  if(next.points)for(const point of next.points){point.x+=dx;point.y+=dy;}
  if(next.path)transformPath(next.path,(x,y)=>({x:x+dx,y:y+dy}));
  if(next.runs)next.runs=next.runs.map(([y,start,end])=>[y+dy,start+dx,end+dx]);if(next.kind==='alpha'){next.offsetX=(next.offsetX||0)+dx;next.offsetY=(next.offsetY||0)+dy;}return next;
}
export function alphaSelection(pixels,width,height){const bounds=selectionFromPixels(pixels,width,height);return bounds?{...bounds,kind:'alpha',pixels:new Uint8ClampedArray(pixels),width,height,offsetX:0,offsetY:0}:null;}
export function selectionWeight(selection,x,y){if(selection?.kind!=='alpha')return 1;const px=Math.floor(x-(selection.offsetX||0)),py=Math.floor(y-(selection.offsetY||0)),value=px<0||py<0||px>=selection.width||py>=selection.height?0:selection.pixels[py*selection.width+px]/255;return selection.inverse?1-value:value;}
export function featherPixels(input,width,height,radius){
  const r=Math.max(1,Math.min(1000,Math.round(radius*.58))),size=r*2+1;let source=new Float32Array(input);
  for(let pass=0;pass<3;pass++){
    const temp=new Float32Array(input.length),output=new Float32Array(input.length);
    for(let y=0;y<height;y++){let sum=0;for(let x=0;x<=Math.min(width-1,r);x++)sum+=source[y*width+x];for(let x=0;x<width;x++){temp[y*width+x]=sum/size;if(x-r>=0)sum-=source[y*width+x-r];if(x+r+1<width)sum+=source[y*width+x+r+1];}}
    for(let x=0;x<width;x++){let sum=0;for(let y=0;y<=Math.min(height-1,r);y++)sum+=temp[y*width+x];for(let y=0;y<height;y++){output[y*width+x]=sum/size;if(y-r>=0)sum-=temp[(y-r)*width+x];if(y+r+1<height)sum+=temp[(y+r+1)*width+x];}}source=output;
  }return new Uint8ClampedArray(source);
}
export function selectionFromPixels(pixels,width,height){
  const runs=[];let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++){let x=0;while(x<width){while(x<width&&!pixels[y*width+x])x++;if(x===width)break;const start=x;while(x<width&&pixels[y*width+x])x++;runs.push([y,start,x]);left=Math.min(left,start);right=Math.max(right,x);top=Math.min(top,y);bottom=y;}}
  return runs.length?{kind:'mask',x:left,y:top,w:right-left,h:bottom-top+1,runs}:null;
}
export function traceSelectionRuns(context,selection,offsetX=0,offsetY=0){for(const [y,start,end] of selection.runs)context.rect(start+offsetX,y+offsetY,end-start,1);}
const outlines=new WeakMap();
export function traceSelectionOutline(context,selection){
  let edges=outlines.get(selection);
  if(!edges){
    edges=[];const rows=new Map();for(const [y,start,end]of selection.runs){if(!rows.has(y))rows.set(y,[]);rows.get(y).push([start,end]);}
    const exposed=(start,end,neighbors,y)=>{let cursor=start;for(const [a,b]of neighbors||[]){if(b<=cursor)continue;if(a>=end)break;if(a>cursor)edges.push([cursor,y,Math.min(a,end),y]);cursor=Math.max(cursor,b);if(cursor>=end)break;}if(cursor<end)edges.push([cursor,y,end,y]);};
    for(const [y,start,end]of selection.runs){edges.push([start,y,start,y+1],[end,y,end,y+1]);exposed(start,end,rows.get(y-1),y);exposed(start,end,rows.get(y+1),y+1);}outlines.set(selection,edges);
  }
  for(const [x1,y1,x2,y2]of edges){context.moveTo(x1,y1);context.lineTo(x2,y2);}
}
export function colorSelection(image,x,y,tolerance=32,contiguous=true,antiAlias=true){return alphaSelection(wandCoverage(image,{x,y,tolerance,contiguous,antiAlias}),image.width,image.height);}

function extrema(input,width,height,radius,horizontal,dilate){
  const output=new Uint8Array(input.length),length=horizontal?width:height,lines=horizontal?height:width;
  const at=(line,i)=>horizontal?line*width+i:i*width+line;
  for(let line=0;line<lines;line++){
    const queue=new Int32Array(length);let head=0,tail=0,added=-1;
    for(let i=0;i<length;i++){
      const end=Math.min(length-1,i+radius);while(added<end){const next=++added,value=input[at(line,next)];while(tail>head&&(dilate?input[at(line,queue[tail-1])]<=value:input[at(line,queue[tail-1])]>=value))tail--;queue[tail++]=next;}
      while(tail>head&&queue[head]<i-radius)head++;
      output[at(line,i)]=!dilate&&(i-radius<0||i+radius>=length)?0:input[at(line,queue[head])];
    }
  }return output;
}
export function extremePixels(input,width,height,radius,dilate){return extrema(extrema(input,width,height,radius,true,dilate),width,height,radius,false,dilate);}
export function modifySelection(input,width,height,amount,mode){
  const radius=Math.max(1,Math.min(1000,Math.round(amount)));
  const morph=dilate=>extrema(extrema(input,width,height,radius,true,dilate),width,height,radius,false,dilate);
  let output;
  if(mode==='border'){const outer=morph(true),inner=morph(false);output=outer.map((v,i)=>v&&!inner[i]?1:0);}
  else output=morph(mode==='expand');
  return selectionFromPixels(output,width,height);
}
export function combineSelections(a,b,width,height,operation){
  const values=new Uint8Array(width*height);
  const write=(selection,bit)=>{if(!selection)return;for(const [y,start,end]of selection.runs)for(let x=start;x<end;x++)values[y*width+x]|=bit;};write(a,1);write(b,2);
  for(let i=0;i<values.length;i++){const v=values[i];values[i]=operation==='subtract'?Number(v===1):operation==='intersect'?Number(v===3):Number(v>0);}
  return selectionFromPixels(values,width,height);
}
