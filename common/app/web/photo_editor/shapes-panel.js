import {editShapePresets,shapePresetGroups} from './shape-presets.js';
export function shapesPanelOpen(){const panel=document.getElementById('shapes-panel');return Boolean(panel&&!panel.hidden);}
export function refreshShapesPanel(){const panel=document.getElementById('shapes-panel');if(panel&&!panel.hidden&&panel._paint)panel._paint();}
export function openShapesPanel({getGroups,getCustom,getSelected,setSelected,onSelect,onPlace,onNew}){
  const existing=document.getElementById('shapes-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;
  if(!panel){panel=document.createElement('section');panel.id='shapes-panel';panel.style.cssText='position:fixed;right:16px;top:280px;z-index:40;width:250px;max-height:360px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  const closedFirst=new Set(),opened=new Set();
  const button=(text,on)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=on;return node;};
  const paint=()=>{
    const groups=shapePresetGroups(getGroups(),getCustom()),selected=getSelected();
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Shapes';title.append(name,button('×',()=>{panel.hidden=true;}));
    const list=document.createElement('div');list.style.cssText='overflow:auto;max-height:260px';
    groups.forEach((group,index)=>{
      const expanded=index===0?!closedFirst.has(group.name):opened.has(group.name);
      const header=button((expanded?'▾ ':'▸ ')+group.name,()=>{if(index===0){if(closedFirst.has(group.name))closedFirst.delete(group.name);else closedFirst.add(group.name);}else if(opened.has(group.name))opened.delete(group.name);else opened.add(group.name);paint();});
      header.style.cssText='display:block;width:100%;text-align:left;background:transparent;color:#aaa;border:0';
      list.append(header);
      if(!expanded)return;
      for(const item of group.items){const row=button(item.name,()=>{setSelected(item.name);onSelect(item.name);paint();});row.ondblclick=event=>{event.stopPropagation();onPlace(item.name);};row.style.cssText='display:block;width:100%;text-align:left;background:'+(item.name===selected?'#3a5':'#1d1d1d')+';color:#eee;border:0;padding:3px 8px';list.append(row);}
    });
    const bar=document.createElement('div');bar.style.display='flex';bar.style.gap='4px';
    bar.append(button('Group',()=>{editShapePresets(getGroups(),getCustom(),{action:'newGroup',name:'Group'});paint();}),button('New',()=>{onNew();paint();}),button('Delete',()=>{const key=getSelected();if(!key)return;editShapePresets(getGroups(),getCustom(),{action:'delete',preset:key});setSelected(null);paint();}));
    panel.replaceChildren(title,list,bar);
  };
  panel._paint=paint;paint();
}
