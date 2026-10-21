// PhotoCraft replace_fonts with the default family. An empty family is not missing.
export function replaceMissingFonts(layers,available,fallback='Inter',map=null){
  const have=new Set(available||[]);
  const missing=[];
  let replaced=0;
  const updates=[];
  const swap=name=>{if(!name||have.has(name))return name;if(!missing.includes(name))missing.push(name);if(map&&typeof map[name]==='string'&&map[name])return map[name];return fallback==null?name:fallback;};
  for(const layer of layers||[]){
    if(!layer?.text)continue;
    const text={...layer.text};
    let changed=false;
    if(text.font){const next=swap(text.font);if(next!==text.font){text.font=next;changed=true;}}
    if(Array.isArray(text.runs))text.runs=text.runs.map(run=>{const font=run.style?.font;if(!font)return run;const next=swap(font);if(next===font)return run;changed=true;return {...run,style:{...run.style,font:next}};});
    if(changed){replaced++;updates.push({id:layer.id,text});}
  }
  return {missing,replaced,updates};
}
