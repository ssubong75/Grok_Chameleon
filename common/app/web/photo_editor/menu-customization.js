// Edit › Menus visibility and colours, and interface.showMenuColors.
// PhotoCraft prefs.rs MenuCustomization and ui-egui menus.rs menu_tint.
const COLORS=['none','red','orange','yellow','green','blue','violet','gray'];
const TINTS={red:'#be3c3c',orange:'#c87828',yellow:'#beaa28',green:'#3c9646',blue:'#326ec8',violet:'#8250be',gray:'#787878'};
const LOCKED=new Set(['edit.menus','edit.keyboardShortcuts','file.save','file.saveAs','file.project','file.exit']);
export function menuHideable(id){return !LOCKED.has(id)&&!String(id).startsWith('edit.preferences');}
export function menuLeaves(menus){
  const out=[];
  const walk=(entries,path)=>{for(const entry of entries||[]){if(!entry)continue;if(Array.isArray(entry[1]))walk(entry[1],[...path,entry[0]]);else out.push({id:entry[1],label:entry[0],path,shortcut:entry[2]||''});}};
  for(const [name,entries] of Object.entries(menus||{}))walk(entries,[name]);
  return out;
}
export function normalizeMenuHidden(value){
  const list=Array.isArray(value)?value:typeof value==='string'?JSON.parse(value||'[]'):value==null?[]:null;
  if(!Array.isArray(list)||list.length>5000||list.some(id=>typeof id!=='string'||id.length>200))throw Error('Choose listed menu items.');
  return [...new Set(list.filter(menuHideable))];
}
export function normalizeMenuColors(value){
  const map=value&&typeof value==='object'&&!Array.isArray(value)?value:typeof value==='string'?JSON.parse(value||'{}'):value==null?{}:null;
  if(!map||Array.isArray(map))throw Error('Choose a listed menu color.');
  const out={};
  for(const [id,color] of Object.entries(map)){if(typeof id!=='string'||id.length>200||!COLORS.includes(color)||color==='none')throw Error('Choose a listed menu color.');out[id]=color;}
  return out;
}
export function menuIsHidden(prefs,id){return menuHideable(id)&&normalizeMenuHidden(prefs?.menuHidden).includes(id);}
export function menuTint(prefs,id){if(!prefs?.showMenuColors)return '';const color=normalizeMenuColors(prefs.menuColors)[id];return TINTS[color]||'';}
export function menuSubtreeVisible(entries,prefs){return (entries||[]).some(entry=>entry&&(Array.isArray(entry[1])?menuSubtreeVisible(entry[1],prefs):!menuIsHidden(prefs,entry[1])));}
export function mountMenuEditor(body,menus,prefs){
  const draft={hidden:normalizeMenuHidden(prefs?.menuHidden),colors:normalizeMenuColors(prefs?.menuColors)};
  const search=document.createElement('input');search.type='search';search.placeholder='command or shortcut';search.setAttribute('aria-label','Search');
  const list=document.createElement('div');list.className='menu-editor-list';list.setAttribute('role','list');
  const items=menuLeaves(menus);
  const paint=()=>{const needle=search.value.trim().toLowerCase();list.replaceChildren();let last='';for(const item of items){const hay=`${item.path.join(' ')} ${item.label} ${item.id}`.toLowerCase();if(needle&&!hay.includes(needle)&&!item.id.toLowerCase().includes(needle))continue;const top=item.path[0]||'Other';if(top!==last){const heading=document.createElement('h4');heading.textContent=top;list.append(heading);last=top;}const row=document.createElement('div');row.className='menu-editor-row';const name=document.createElement('span');const rest=item.path.slice(1);name.textContent=`${rest.length?rest.join(' › ')+' › ':''}${item.label}`;const visibleLabel=document.createElement('label');const visible=document.createElement('input');visible.type='checkbox';const hideable=menuHideable(item.id);visible.checked=!hideable||!draft.hidden.includes(item.id);visible.disabled=!hideable;visible.setAttribute('aria-label','Visible');visible.onchange=()=>{if(!hideable)return;if(visible.checked)draft.hidden=draft.hidden.filter(id=>id!==item.id);else if(!draft.hidden.includes(item.id))draft.hidden.push(item.id);};visibleLabel.append(visible,document.createTextNode('Visible'));const color=document.createElement('select');color.setAttribute('aria-label','Color');for(const choice of COLORS){const option=document.createElement('option');option.value=choice;option.textContent=choice;color.append(option);}color.value=draft.colors[item.id]||'none';color.onchange=()=>{if(color.value==='none')delete draft.colors[item.id];else draft.colors[item.id]=color.value;};row.append(name,visibleLabel,color);list.append(row);}};
  search.oninput=paint;body.append(search,list);paint();
  return ()=>({hidden:draft.hidden.slice(),colors:{...draft.colors}});
}
