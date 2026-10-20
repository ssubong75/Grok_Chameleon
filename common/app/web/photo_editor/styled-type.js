import {glyphFallback} from './glyph-preferences.js';
import {graphemeEntries,normalizeTextRuns} from './rich-text.js';

const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
function setFont(ctx,style){
  const size=Math.max(.1,Math.min(2000,num(style.size,48))),family=String(style.font||'Inter').replace(/["\\]/g,'');
  ctx.font=`${style.italic?'italic ':''}${style.bold?'600':'400'} ${size}px "${family}"${glyphFallback()}`;
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.direction=style.direction==='rtl'?'rtl':'ltr';ctx.fontKerning=style.kerning==='off'?'none':'normal';if('letterSpacing'in ctx)ctx.letterSpacing='0px';return size;
}
export {setFont as setTypeFont};
function spansFor(ctx,glyphs){
  const spans=[];
  for(const glyph of glyphs){const last=spans.at(-1);if(last&&last.style===glyph.style)last.value+=glyph.value;else spans.push({value:glyph.value,style:glyph.style});}
  let advance=0,ascent=0,descent=0,size=0;
  for(let index=0;index<spans.length;index++){
    const span=spans[index],s=setFont(ctx,span.style),metrics=ctx.measureText(span.value),count=graphemeEntries(span.value).length,tracking=num(span.style.tracking),shift=num(span.style.baselineShift);
    const scaleX=Math.max(.01,num(span.style.glyphScaleX,1)),scaleY=Math.max(.01,num(span.style.glyphScaleY,1));
    span.size=s;span.tracking=tracking;span.glyphScaleX=scaleX;span.glyphScaleY=scaleY;
    span.width=(metrics.width+Math.max(0,count-1)*tracking)*scaleX;span.advance=span.width+(index<spans.length-1?tracking*scaleX:0);
    span.ascent=(metrics.actualBoundingBoxAscent||s*.8)*scaleY;span.descent=(metrics.actualBoundingBoxDescent||s*.2)*scaleY;
    span.left=(metrics.actualBoundingBoxLeft||0)*scaleX;span.right=Math.max(span.width,((metrics.actualBoundingBoxRight||metrics.width)+Math.max(0,(count-1)*tracking))*scaleX);
    advance+=span.advance;ascent=Math.max(ascent,(metrics.fontBoundingBoxAscent||s*.8)*scaleY+shift,span.ascent+shift);descent=Math.max(descent,span.descent-shift+s*.15*scaleY);size=Math.max(size,s*scaleY);
  }
  // Color and decoration boundaries should not remove a font's pair kerning.
  for(let index=1;index<spans.length;index++){
    const previous=spans[index-1],current=spans[index];
    if(current.style.kerning==='off'||!['font','size','bold','italic','kerning','direction'].every(key=>previous.style[key]===current.style[key]))continue;
    setFont(ctx,current.style);const a=graphemeEntries(previous.value).at(-1)?.value,b=graphemeEntries(current.value)[0]?.value;
    if(a&&b){const adjustment=(ctx.measureText(a+b).width-ctx.measureText(a).width-ctx.measureText(b).width)*num(previous.style.glyphScaleX,1);previous.advance+=adjustment;advance+=adjustment;}
  }
  return{spans,advance,ascent,descent,size};
}
function trimEnd(glyphs){let length=glyphs.length;while(length&&/^\s+$/u.test(glyphs[length-1].value))length--;return glyphs.slice(0,length);}
export function applyCaps(value,caps,style){
  if(caps!=='all'&&caps!=='small')return {value,style};
  let out='',scale=false;
  for(const ch of value){const up=ch.toLocaleUpperCase();if(up.length!==ch.length){out+=ch;continue;}out+=up;if(caps==='small'&&ch!==up)scale=true;}
  if(!scale)return {value:out,style};
  return {value:out,style:{...style,glyphScaleX:num(style.glyphScaleX,1)*0.7,glyphScaleY:num(style.glyphScaleY,1)*0.7}};
}
export function layoutStyledType(text,ctx){
  const value=String(text.value??'').replace(/\r\n?/g,'\n'),runs=normalizeTextRuns(value,text.runs),base={...text},styles=new Map(),glyphs=[];let runIndex=0;
  for(const entry of graphemeEntries(value)){
    while(runs[runIndex]&&runs[runIndex].end<=entry.start)runIndex++;
    const run=runs[runIndex],active=run&&run.start<=entry.start?run:null;let style=base;
    if(active){if(!styles.has(active))styles.set(active,{...base,...active.style});style=styles.get(active);}
    const caps=style.caps&&style.caps!=='normal'?style.caps:text.caps,shaped=applyCaps(entry.value,caps,style);
    glyphs.push({...entry,value:shaped.value,style:shaped.style});
  }
  const x=num(text.x),y=num(text.y),box=text.mode==='paragraph',vertical=text.orientation==='vertical',width=Math.max(1,num(text.boxWidth,400)),height=Math.max(1,num(text.boxHeight,300)),indent=num(text.startIndent),endIndent=num(text.endIndent),firstIndent=num(text.firstLineIndent),items=[];
  const paragraphs=[[]];for(const glyph of glyphs){if(glyph.value==='\n')paragraphs.push([]);else paragraphs.at(-1).push(glyph);}
  let cursor=num(text.spaceBefore),left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const include=(xx,yy,ww,hh)=>{left=Math.min(left,xx);top=Math.min(top,yy);right=Math.max(right,xx+ww);bottom=Math.max(bottom,yy+hh);};
  for(const paragraph of paragraphs){
    const lines=[];let line=[],first=true;
    const available=()=>Math.max(1,(vertical?height:width)-indent-endIndent-(first?firstIndent:0));
    const measure=g=>vertical?g.reduce((sum,glyph,index)=>sum+Math.max(.1,num(glyph.style.size,48))+(index<g.length-1?num(glyph.style.tracking):0),0):spansFor(ctx,g).advance;
    const push=()=>{lines.push({glyphs:trimEnd(line),first,last:false});line=[];first=false;};
    if(box){
      const tokens=[];for(const glyph of paragraph){const space=/^\s+$/u.test(glyph.value),last=tokens.at(-1);if(last&&last.space===space)last.glyphs.push(glyph);else tokens.push({space,glyphs:[glyph]});}
      for(const token of tokens){
        if(line.length&&measure([...line,...token.glyphs])>available()){push();if(token.space)continue;}
        if(measure(token.glyphs)>available())for(const glyph of token.glyphs){if(line.length&&measure([...line,glyph])>available())push();line.push(glyph);}else line.push(...token.glyphs);
      }
    }else line=paragraph;
    lines.push({glyphs:box?trimEnd(line):line,first,last:true});
    for(const entry of lines){
      const firstOffset=entry.first?firstIndent:0,available=(vertical?height:width)-indent-endIndent-firstOffset;
      const lineMetrics=spansFor(ctx,entry.glyphs),baseSize=setFont(ctx,base),largest=lineMetrics.size||baseSize;
      let advance=vertical?measure(entry.glyphs):lineMetrics.advance;
      const spaces=entry.glyphs.filter(glyph=>/^\s+$/u.test(glyph.value)).length,justify=box&&String(text.align).startsWith('justify')&&(!entry.last||text.align==='justifyAll'),extra=justify&&spaces?Math.max(0,available-advance)/spaces:0;
      let align=text.align||'left';if(entry.last&&align.startsWith('justify'))align=align==='justifyCenter'?'center':align==='justifyRight'?'right':'left';
      const offset=align==='center'?(box?(available-advance)/2:-advance/2):align==='right'?(box?available-advance:-advance):0;
      if(vertical){
        const xx=x-cursor;let yy=y+(box?indent:0)+firstOffset+offset;
        const placed=[];for(const glyph of entry.glyphs){const size=setFont(ctx,glyph.style),m=ctx.measureText(glyph.value),shift=num(glyph.style.baselineShift),scaleX=num(glyph.style.glyphScaleX,1),scaleY=num(glyph.style.glyphScaleY,1),ascent=(m.actualBoundingBoxAscent||size*.8)*scaleY,descent=(m.actualBoundingBoxDescent||size*.2)*scaleY;
          placed.push({value:glyph.value,style:glyph.style,size,glyphScaleX:scaleX,glyphScaleY:scaleY,x:xx+shift,y:yy+ascent});include(xx+shift-(m.actualBoundingBoxLeft||0)*scaleX,yy,Math.max(size*scaleX,(m.actualBoundingBoxRight||m.width)*scaleX)+Math.max(0,(m.actualBoundingBoxLeft||0)*scaleX)+size*.2*scaleX,ascent+descent);
          yy+=size*scaleY+num(glyph.style.tracking)+(/^\s+$/u.test(glyph.value)?extra:0);
        }
        items.push({rich:true,vertical:true,glyphs:placed});
      }else{
        // Split on spaces only when justification needs an independent advance.
        let measured=lineMetrics;
        if(extra){const spans=[];let chunk=[];const flush=()=>{if(chunk.length){spans.push(...spansFor(ctx,chunk).spans);chunk=[];}};for(const glyph of entry.glyphs){if(/^\s+$/u.test(glyph.value)){flush();const span=spansFor(ctx,[glyph]).spans[0];span.advance+=num(glyph.style.tracking)+extra;spans.push(span);}else chunk.push(glyph);}flush();
          for(let index=0;index<spans.length-1;index++)if(!/^\s+$/u.test(spans[index].value)&&spans[index].advance===spans[index].width)spans[index].advance+=spans[index].tracking;
          measured={...lineMetrics,spans};
        }
        const baseline=y+cursor+(lineMetrics.ascent||baseSize*.8),placed=[];let xx=x+(box?indent:0)+firstOffset+offset;
        const ordered=text.direction==='rtl'?measured.spans.slice().reverse():measured.spans;
        for(const span of ordered){const yy=baseline-num(span.style.baselineShift);placed.push({...span,x:xx,y:yy});include(xx-span.left,yy-span.ascent,Math.max(span.advance,span.right)+span.left,span.ascent+span.descent+span.size*.15);xx+=span.advance;}
        items.push({rich:true,vertical:false,spans:placed});
      }
      const leading=text.leadingPx?Math.max(.1,num(text.leadingPx)):Math.max(.1,num(text.leading,1.2))*largest;
      cursor+=Math.max(leading,vertical?largest:lineMetrics.ascent+lineMetrics.descent);
    }
    cursor+=num(text.spaceAfter)+num(text.spaceBefore);
  }
  if(!Number.isFinite(left)){left=x;top=y;right=x+1;bottom=y+Math.max(.1,num(text.size,48));}
  if(box){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+width);bottom=Math.max(bottom,y+height);}
  return{rich:true,items,bounds:{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)},box:box?{x,y,w:width,h:height}:null};
}
function paintSpan(ctx,span){
  const scaleX=span.glyphScaleX||1,scaleY=span.glyphScaleY||1,manual=scaleX!==1||scaleY!==1||(span.tracking&&!('letterSpacing'in ctx));
  if(!manual){ctx.fillText(span.value,span.x,span.y);return;}
  ctx.save();ctx.translate(span.x,span.y);ctx.scale(scaleX,scaleY);
  if(span.tracking){let prefix='',count=0;for(const glyph of graphemeEntries(span.value)){const at=ctx.measureText(prefix+glyph.value).width-ctx.measureText(glyph.value).width+count*span.tracking;ctx.fillText(glyph.value,at,0);prefix+=glyph.value;count++;}}
  else ctx.fillText(span.value,0,0);
  ctx.restore();
}
export function renderStyledType(ctx,layout){
  for(const item of layout.items)for(const span of item.vertical?item.glyphs:item.spans){
    const size=setFont(ctx,span.style);ctx.fillStyle=span.style.color||'#000000';
    if(!item.vertical&&span.tracking&&(span.glyphScaleX||1)===1&&(span.glyphScaleY||1)===1&&'letterSpacing'in ctx)ctx.letterSpacing=span.tracking+'px';
    paintSpan(ctx,span);
    if('letterSpacing'in ctx)ctx.letterSpacing='0px';const thickness=Math.max(1,size/16),scaleX=span.glyphScaleX||1,scaleY=span.glyphScaleY||1;
    if(item.vertical){if(span.style.underline)ctx.fillRect(span.x+size*scaleX*1.08,span.y-size*scaleY*.8,thickness,size*scaleY);if(span.style.strike)ctx.fillRect(span.x+size*scaleX*.5,span.y-size*scaleY*.8,thickness,size*scaleY);}
    else{if(span.style.underline)ctx.fillRect(span.x,span.y+size*.1,span.width,thickness);if(span.style.strike)ctx.fillRect(span.x,span.y-size*.32,span.width,thickness);}
  }
}
