// Run offsets use the same UTF-16 indices as textarea selections and project JSON.
const flags=['bold','italic','underline','strike'];
const metrics={size:[.1,2000],tracking:[-100,1000],baselineShift:[-5000,5000]};
export function characterStyle(value={}){
  const style={};
  if(!value||typeof value!=='object')return style;
  if(typeof value.font==='string'&&value.font.trim())style.font=value.font.replace(/["\\]/g,'');
  if(typeof value.color==='string'&&/^#[\da-f]{6}$/i.test(value.color))style.color=value.color;
  for(const key of flags)if(typeof value[key]==='boolean')style[key]=value[key];
  for(const [key,[min,max]]of Object.entries(metrics))if(value[key]!==undefined&&value[key]!==null&&value[key]!==''&&Number.isFinite(Number(value[key])))style[key]=Math.max(min,Math.min(max,Number(value[key])));
  return style;
}
export function graphemeEntries(value){
  const text=String(value);
  if(typeof Intl.Segmenter==='function')return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(({segment,index})=>({value:segment,start:index,end:index+segment.length}));
  let index=0;return Array.from(text,value=>{const entry={value,start:index,end:index+value.length};index=entry.end;return entry;});
}
const equal=(a,b)=>Object.keys({...a,...b}).every(key=>a[key]===b[key]);
export function normalizeTextRuns(value,runs=[]){
  const text=String(value),boundaries=[0,...graphemeEntries(text).map(item=>item.end)];
  const floor=index=>{let lo=0,hi=boundaries.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(boundaries[mid]<=index)lo=mid;else hi=mid-1;}return boundaries[lo];};
  const ceil=index=>{let lo=0,hi=boundaries.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(boundaries[mid]<index)lo=mid+1;else hi=mid;}return boundaries[lo];};
  let output=[];
  for(const run of Array.isArray(runs)?runs:[]){
    if(!run||!Number.isFinite(run.start)||!Number.isFinite(run.end)||run.end<=run.start)continue;
    const start=floor(Math.max(0,Math.min(text.length,run.start))),end=ceil(Math.max(0,Math.min(text.length,run.end))),style=characterStyle(run.style);
    if(end<=start||!Object.keys(style).length)continue;
    if(!output.length||output.at(-1).end<=start){output.push({start,end,style});continue;}
    const next=[];for(const old of output){if(old.end<=start||old.start>=end)next.push(old);else{if(old.start<start)next.push({...old,end:start});if(old.end>end)next.push({...old,start:end});}}
    next.push({start,end,style});output=next.sort((a,b)=>a.start-b.start);
  }
  const merged=[];for(const run of output){const last=merged.at(-1);if(last&&last.end===run.start&&equal(last.style,run.style))last.end=run.end;else merged.push({...run,style:{...run.style}});}return merged;
}
export function applyCharacterStyle(value,runs,start,end,patch,reset=false){
  const text=String(value),glyphs=graphemeEntries(text),normalized=normalizeTextRuns(text,runs),style=characterStyle(patch),output=[];let index=0;
  for(const glyph of glyphs){while(normalized[index]&&normalized[index].end<=glyph.start)index++;const old=normalized[index],inherited=old&&old.start<=glyph.start?old.style:{};
    const selected=glyph.end>start&&glyph.start<end,next=selected?(reset?{}:{...inherited,...style}):inherited;
    if(Object.keys(next).length)output.push({start:glyph.start,end:glyph.end,style:next});}
  return normalizeTextRuns(text,output);
}
export function rebaseTextRuns(previous,value,runs){
  const before=String(previous),after=String(value),normalized=normalizeTextRuns(before,runs);if(before===after)return normalized;
  // Compare whole graphemes, keeping combining marks and surrogate pairs together.
  const a=graphemeEntries(before),b=graphemeEntries(after);let prefix=0,suffix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix].value===b[prefix].value)prefix++;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix].value===b[b.length-1-suffix].value)suffix++;
  const start=prefix?a[prefix-1].end:0,oldEnd=suffix?a[a.length-suffix].start:before.length,newEnd=suffix?b[b.length-suffix].start:after.length,delta=newEnd-oldEnd,output=[];
  for(const run of normalized){if(run.start<start)output.push({...run,end:Math.min(run.end,start)});if(run.end>oldEnd)output.push({...run,start:Math.max(run.start,oldEnd)+delta,end:run.end+delta});}
  const inherited=normalized.find(run=>run.start<=start&&run.end>start)||normalized.find(run=>run.start<start&&run.end===start);
  if(newEnd>start&&inherited)output.push({start,end:newEnd,style:inherited.style});return normalizeTextRuns(after,output);
}
