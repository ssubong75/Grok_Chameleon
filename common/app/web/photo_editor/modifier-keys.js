// Window › Modifier Keys. Latched Shift, Ctrl, and Alt are added to the real tool-event modifiers.
// On Windows the command latch sets Ctrl. A real key stays down when the latch is off.
export function stickyEvent(flags,event){
  const held=flags||{};
  return new Proxy(event,{get(target,key){
    if(key==='shiftKey')return Boolean(target.shiftKey)||held.shift===true;
    if(key==='altKey')return Boolean(target.altKey)||held.alt===true;
    if(key==='ctrlKey')return Boolean(target.ctrlKey)||held.command===true;
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}
export function modifierKeysPanelOpen(){const panel=document.getElementById('modifier-keys-panel');return Boolean(panel&&!panel.hidden);}
export function openModifierKeysPanel({getFlags}){
  const existing=document.getElementById('modifier-keys-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;
  if(!panel){panel=document.createElement('section');panel.id='modifier-keys-panel';panel.style.cssText='position:fixed;left:16px;top:80px;z-index:40;width:150px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  const paint=()=>{
    const flags=getFlags();
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Modifier Keys';const close=document.createElement('button');close.type='button';close.textContent='×';close.onclick=()=>{panel.hidden=true;};title.append(name,close);
    const row=document.createElement('div');row.style.display='flex';row.style.gap='4px';
    for(const [label,key] of [['Shift','shift'],['Ctrl','command'],['Alt','alt']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='min-width:40px;height:30px;background:'+(flags[key]?'#3a5':'#1d1d1d')+';color:#eee;border:0';button.onclick=()=>{flags[key]=!flags[key];paint();};row.append(button);}
    panel.replaceChildren(title,row);
  };
  paint();
}
