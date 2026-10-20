function parts(shortcut){
  const bits=String(shortcut||'').split('+').filter(Boolean);
  const key=bits.pop()||'';
  return {ctrl:bits.includes('Ctrl')||bits.includes('Cmd'),shift:bits.includes('Shift'),alt:bits.includes('Alt'),key};
}
export function shortcutMatches(shortcut,event){
  const want=parts(shortcut);
  if(!want.key)return false;
  if(want.ctrl!==Boolean(event.ctrlKey||event.metaKey))return false;
  if(want.shift!==Boolean(event.shiftKey))return false;
  if(want.alt!==Boolean(event.altKey))return false;
  const key=event.key.length===1?event.key.toUpperCase():event.key;
  return key===want.key.toUpperCase()||key===want.key;
}
export function shortcutCommand(entries,event){
  const found=[];
  const walk=list=>{for(const entry of list||[]){if(!entry)continue;if(Array.isArray(entry[1]))walk(entry[1]);else if(entry[3]!==false&&entry[2]&&shortcutMatches(entry[2],event))found.push(entry[1]);}};
  for(const list of Object.values(entries||{}))walk(list);
  return found[0]||null;
}
