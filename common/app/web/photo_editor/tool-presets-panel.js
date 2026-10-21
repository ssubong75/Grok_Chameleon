import {editToolPreset,listToolPresets,newToolPreset} from './tool-presets.js';
export function toolPresetsPanelOpen(){const panel=document.getElementById('tool-presets-panel');return Boolean(panel&&!panel.hidden);}
export function openToolPresetsPanel({getPresets,getTool,getOnly,setOnly,onSelect,onNew}){
  const existing=document.getElementById('tool-presets-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;
  if(!panel){panel=document.createElement('section');panel.id='tool-presets-panel';panel.style.cssText='position:fixed;right:16px;top:560px;z-index:40;width:250px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  let selected=null;
  const button=(text,on)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=on;return node;};
  const paint=()=>{
    const only=getOnly(),items=listToolPresets(getPresets(),only?getTool():null);
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Tool Presets';title.append(name,button('×',()=>{panel.hidden=true;}));
    const list=document.createElement('div');list.style.cssText='overflow:auto;max-height:260px';
    if(!items.length){const empty=document.createElement('div');empty.textContent=only?'No presets for the current tool.':'No tool presets.';empty.style.color='#aaa';list.append(empty);}
    for(const item of items){const row=button(item.name+'  '+item.tool,()=>{selected=item.name;onSelect(item.name);paint();});row.style.cssText='display:block;width:100%;text-align:left;background:'+(item.name===selected?'#3a5':'#1d1d1d')+';color:#eee;border:0;padding:4px 6px';list.append(row);}
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:6px;align-items:center';
    const onlyLabel=document.createElement('label');const onlyBox=document.createElement('input');onlyBox.type='checkbox';onlyBox.checked=only;onlyBox.onchange=()=>{setOnly(onlyBox.checked);paint();};onlyLabel.append(onlyBox,' Current Tool Only');
    bar.append(onlyLabel,button('New',()=>{const made=onNew();selected=made?.name||selected;paint();}),button('Delete',()=>{if(!selected)return;editToolPreset(getPresets(),{action:'delete',preset:selected});selected=null;paint();}));
    panel.replaceChildren(title,list,bar);
  };
  panel._paint=paint;paint();
}
