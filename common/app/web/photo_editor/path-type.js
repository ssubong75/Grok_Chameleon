import {graphemeEntries,normalizeTextRuns} from './rich-text.js';
import {setTypeFont} from './styled-type.js';
import {measurePath,pointAtDistance} from './path-metrics.js';

const num=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
export function layoutPathType(text,ctx){
  if(text.orientation==='vertical')throw Error('Text on a path requires horizontal text orientation.');
  const metrics=measurePath(text.path);if(metrics.length<=0)throw Error('The selected text path has no length.');
  const value=String(text.value??'').replace(/\r\n?/g,'\n'),runs=normalizeTextRuns(value,text.runs),paragraphs=[[]],styles=new Map();let runIndex=0;
  for(const entry of graphemeEntries(value)){
    while(runs[runIndex]&&runs[runIndex].end<=entry.start)runIndex++;const run=runs[runIndex],active=run&&run.start<=entry.start?run:null;
    if(active&&!styles.has(active))styles.set(active,{...text,...active.style});const style=active?styles.get(active):text;
    if(entry.value==='\n'){paragraphs.push([]);continue;}
    const glyph={value:text.caps==='all'?entry.value.toLocaleUpperCase():entry.value,style};glyph.size=setTypeFont(ctx,style);const m=ctx.measureText(glyph.value);
    glyph.width=m.width;glyph.advance=m.width+num(style.tracking);glyph.ascent=m.actualBoundingBoxAscent||glyph.size*.8;glyph.descent=m.actualBoundingBoxDescent||glyph.size*.2;glyph.left=m.actualBoundingBoxLeft||0;glyph.right=m.actualBoundingBoxRight||m.width;paragraphs.at(-1).push(glyph);
  }
  const items=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,lineOffset=num(text.spaceBefore),overflow=false;
  for(const glyphs of paragraphs){
    for(let index=1;index<glyphs.length;index++){const a=glyphs[index-1],b=glyphs[index];if(b.style.kerning==='off'||!['font','size','bold','italic','kerning','direction'].every(key=>a.style[key]===b.style[key]))continue;setTypeFont(ctx,b.style);a.advance+=ctx.measureText(a.value+b.value).width-ctx.measureText(a.value).width-ctx.measureText(b.value).width;}
    if(glyphs.length)glyphs.at(-1).advance-=num(glyphs.at(-1).style.tracking);
    const total=glyphs.reduce((sum,glyph)=>sum+glyph.advance,0),start=num(text.pathOffset)+num(text.startIndent)+num(text.firstLineIndent),available=metrics.length-start-num(text.endIndent),align=String(text.align||'left'),spaces=glyphs.filter(glyph=>/^\s+$/u.test(glyph.value)).length,extra=align.startsWith('justify')&&spaces?Math.max(0,available-total)/spaces:0;
    let cursor=start+(align==='center'?(available-total)/2:align==='right'?available-total:0);
    const ordered=text.direction==='rtl'?glyphs.slice().reverse():glyphs;
    for(const glyph of ordered){
      const center=cursor+glyph.width/2,d=text.pathReverse?metrics.length-center:center,point=pointAtDistance(metrics,d);cursor+=glyph.advance+(/^\s+$/u.test(glyph.value)?extra:0);
      if(!point||center<0||center>metrics.length){overflow=true;continue;}
      const angle=point.angle+(text.pathReverse?Math.PI:0)+(text.pathFlip?Math.PI:0),cos=Math.cos(angle),sin=Math.sin(angle),baseline=lineOffset+num(text.pathBaseline)-num(glyph.style.baselineShift),originX=point.x-cos*glyph.width/2-sin*baseline,originY=point.y-sin*glyph.width/2+cos*baseline;
      items.push({...glyph,x:originX,y:originY,angle});
      for(const [xx,yy]of [[-glyph.left,-glyph.ascent],[glyph.right,-glyph.ascent],[-glyph.left,glyph.descent+glyph.size*.18],[glyph.right,glyph.descent+glyph.size*.18]]){const px=originX+cos*xx-sin*yy,py=originY+sin*xx+cos*yy;left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}
    }
    const largest=glyphs.reduce((size,glyph)=>Math.max(size,glyph.size),num(text.size,48));lineOffset+=(text.leadingPx?num(text.leadingPx):largest*Math.max(.1,num(text.leading,1.2)))+num(text.spaceBefore)+num(text.spaceAfter);
  }
  if(!Number.isFinite(left)){const p=metrics.points[0];left=p.x;top=p.y;right=left+1;bottom=top+1;}
  return{path:true,items,overflow,box:null,bounds:{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)}};
}
export function renderPathType(ctx,layout){
  for(const item of layout.items){ctx.save();ctx.translate(item.x,item.y);ctx.rotate(item.angle);const size=setTypeFont(ctx,item.style);ctx.fillStyle=item.style.color||'#000000';ctx.fillText(item.value,0,0);if(item.style.underline)ctx.fillRect(0,size*.1,item.width,Math.max(1,size/16));if(item.style.strike)ctx.fillRect(0,-size*.32,item.width,Math.max(1,size/16));ctx.restore();}
}
