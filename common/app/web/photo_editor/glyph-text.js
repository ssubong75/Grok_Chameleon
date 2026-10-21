// PhotoCraft type.insertText and the Glyphs panel categories. The grid is Unicode blocks, not a font cmap.
export const glyphCategories=['Entire Font','Basic Latin','Latin 1','Latin Extended-A','Latin Extended-B','Greek','Cyrillic','Punctuation','Numbers','Currency','Symbols','Math Symbols','Arrows','Ornaments'];
export function inCategory(char,category){
  const c=[...String(char)][0]||'',u=c.codePointAt(0);
  switch(category){
    case 'Basic Latin':return u>=0x20&&u<=0x7E;
    case 'Latin 1':return u>=0xA0&&u<=0xFF;
    case 'Latin Extended-A':return u>=0x100&&u<=0x17F;
    case 'Latin Extended-B':return u>=0x180&&u<=0x24F;
    case 'Greek':return (u>=0x370&&u<=0x3FF)||(u>=0x1F00&&u<=0x1FFF);
    case 'Cyrillic':return u>=0x400&&u<=0x52F;
    case 'Punctuation':return (/[!-/:-@[-`{-~]/.test(c)&&!'+$<=>^`|~'.includes(c))||[0xA1,0xA7,0xAB,0xB6,0xB7,0xBB,0xBF].includes(u)||(u>=0x2010&&u<=0x2027)||(u>=0x2030&&u<=0x205E)||(u>=0x2E00&&u<=0x2E7F)||(u>=0x3000&&u<=0x303F);
    case 'Numbers':return /\p{N}/u.test(c)||(u>=0x2150&&u<=0x218F);
    case 'Currency':return '$¢£¤¥'.includes(c)||(u>=0x20A0&&u<=0x20CF);
    case 'Symbols':return '©®°¦¨¯´¸™℠№℮^`|~'.includes(c)||(u>=0x2100&&u<=0x214F)||(u>=0x2300&&u<=0x23FF)||(u>=0x2500&&u<=0x25FF);
    case 'Math Symbols':return '+<=>±×÷¬µ¹²³¼½¾'.includes(c)||(u>=0x2070&&u<=0x209F)||(u>=0x2200&&u<=0x22FF)||(u>=0x27C0&&u<=0x27EF)||(u>=0x2980&&u<=0x2AFF);
    case 'Arrows':return (u>=0x2190&&u<=0x21FF)||(u>=0x27F0&&u<=0x27FF)||(u>=0x2900&&u<=0x297F)||(u>=0x2B00&&u<=0x2BFF);
    case 'Ornaments':return (u>=0x2600&&u<=0x27BF)||(u>=0x1F300&&u<=0x1FAFF)||(u>=0xE000&&u<=0xF8FF);
    default:return true;
  }
}
export function glyphsFor(category='Entire Font'){
  const names=category==='Entire Font'?glyphCategories.slice(1):[category];
  const seen=new Set(),out=[];
  for(const name of names){
    const end=name==='Ornaments'?0x27C0:name==='Greek'?0x2000:0x3300;
    for(let u=0x20;u<end;u++){const c=String.fromCodePoint(u);if(!inCategory(c,name)||seen.has(c))continue;seen.add(c);out.push(c);}
  }
  return out;
}
export function insertGlyphText(value,text,options={}){
  if(typeof text!=='string'||!text)throw Error('missing `text`');
  const inserted=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n'),chars=[...String(value??'')],n=chars.length;
  let a,b;
  if(Array.isArray(options.range)&&options.range.length===2){const x=Number(options.range[0])||0,y=Number(options.range[1])||0;a=Math.min(Math.min(x,y),n);b=Math.min(Math.max(x,y),n);}
  else if(options.at!=null){const at=Math.min(Number(options.at)||0,n);a=b=at;}
  else a=b=n;
  return {value:chars.slice(0,a).join('')+inserted+chars.slice(b).join(''),caret:a+[...inserted].length};
}
