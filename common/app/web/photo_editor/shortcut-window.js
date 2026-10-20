// Keyboard Shortcuts and Menus: shortcuts, menu visibility/colours, toolbar visibility.
// PhotoCraft prefs.rs normalize_shortcut / reserved_shortcut and ui-egui prefs_ui shortcuts_body / toolbar_tab.
import {menuLeaves,menuHideable,normalizeMenuHidden,normalizeMenuColors} from './menu-customization.js';
const COLORS=['none','red','orange','yellow','green','blue','violet','gray'];
const RESERVED=new Set(['Cmd+Tab','Cmd+Shift+Tab','Cmd+Alt+Escape','Cmd+`']);
const MAX_ALTERNATES=8,MAX_SETS=64,MAX_NAME=64;
export const TOOLBAR_TOOLS=[['Move','Move Tool','V','move'],['Artboard','Artboard Tool','V','artboard'],['RectMarquee','Rectangular Marquee Tool','M','marquee'],['EllipseMarquee','Elliptical Marquee Tool','M','ellipse'],['SingleRowMarquee','Single Row Marquee Tool','','singleRowMarquee'],['SingleColumnMarquee','Single Column Marquee Tool','','singleColumnMarquee'],['Lasso','Lasso Tool','L','lasso'],['PolygonLasso','Polygonal Lasso Tool','L','polygonLasso'],['MagneticLasso','Magnetic Lasso Tool','L','magnetic'],['MagicWand','Magic Wand Tool','W','wand'],['Crop','Crop Tool','C','crop'],['PerspectiveCrop','Perspective Crop Tool','C','perspectiveCrop'],['Eyedropper','Eyedropper Tool','I','eyedropper'],['ColorSampler','Color Sampler Tool','I','colorSampler'],['Ruler','Ruler Tool','I','ruler'],['Note','Note Tool','I','note'],['Count','Count Tool','I','count'],['Brush','Brush Tool','B','brush'],['Pencil','Pencil Tool','B','pencil'],['MixerBrush','Mixer Brush Tool','B','mixerBrush'],['ColorReplacement','Color Replacement Tool','B','colorReplacement'],['Eraser','Eraser Tool','E','eraser'],['BackgroundEraser','Background Eraser Tool','E','backgroundEraser'],['MagicEraser','Magic Eraser Tool','E','magicEraser'],['Gradient','Gradient Tool','G','gradient'],['PaintBucket','Paint Bucket Tool','G','fill'],['Type','Horizontal Type Tool','T','text'],['VerticalType','Vertical Type Tool','T','verticalType'],['HorizontalTypeMask','Horizontal Type Mask Tool','T','horizontalTypeMask'],['VerticalTypeMask','Vertical Type Mask Tool','T','verticalTypeMask'],['Hand','Hand Tool','H','hand'],['RotateView','Rotate View Tool','R','rotateView'],['Zoom','Zoom Tool','Z','zoom'],['Remove','Remove Tool','J','remove'],['SpotHealing','Spot Healing Brush Tool','J','spotHealing'],['Healing','Healing Brush Tool','J','healing'],['Patch','Patch Tool','J','patch'],['ContentAwareMove','Content-Aware Move Tool','J','contentAwareMove'],['RedEye','Red Eye Tool','J','redEye'],['CloneStamp','Clone Stamp Tool','S','clone'],['PatternStamp','Pattern Stamp Tool','S','patternStamp'],['HistoryBrush','History Brush Tool','Y','historyBrush'],['Blur','Blur Tool','','blurBrush'],['Sharpen','Sharpen Tool','','sharpenBrush'],['Smudge','Smudge Tool','','smudge'],['Dodge','Dodge Tool','O','dodge'],['Burn','Burn Tool','O','burn'],['Sponge','Sponge Tool','O','sponge'],['QuickSelection','Quick Selection Tool','W','quickSelect'],['ObjectSelection','Object Selection Tool','W','objectSelect'],['Pen','Pen Tool','P','pen'],['FreeformPen','Freeform Pen Tool','P','freeformPen'],['CurvaturePen','Curvature Pen Tool','P','curvaturePen'],['AddAnchorPoint','Add Anchor Point Tool','P','addAnchorPoint'],['DeleteAnchorPoint','Delete Anchor Point Tool','P','deleteAnchorPoint'],['ConvertPoint','Convert Point Tool','P','convertPoint'],['PathSelection','Path Selection Tool','A','pathSelection'],['DirectSelection','Direct Selection Tool','A','direct'],['Rectangle','Rectangle Tool','U','rectangle'],['EllipseShape','Ellipse Tool','U','ellipseShape'],['Triangle','Triangle Tool','U','triangle'],['Polygon','Polygon Tool','U','polygon'],['Line','Line Tool','U','line'],['CustomShape','Custom Shape Tool','U','customShape'],['Slice','Slice Tool','C','slice'],['SliceSelect','Slice Select Tool','C','sliceSelect'],['Frame','Frame Tool','K','frame']];
const TOOL_IDS=new Set(TOOLBAR_TOOLS.map(row=>row[0]));
const TEMPORARY=[['tools.temporary.hand','Hand Tool (hold)','Space'],['tools.temporary.zoomIn','Zoom In (hold, drag to scrub)','Cmd+Space'],['tools.temporary.zoomOut','Zoom Out (hold)','Alt+Space'],['tools.temporary.erase','Erase with Brush or Pencil (hold)','`']];
export function normalizeShortcut(value){
  const raw=String(value??'').trim();
  if(!raw)return '';
  const plus=raw.endsWith('++')||raw==='+';
  const body=plus?raw.replace(/\++$/,''):raw;
  let cmd=false,alt=false,shift=false,key='';
  for(const part of body.split('+').filter(Boolean)){
    const name=part.toLowerCase();
    if(['cmd','command','meta','super','ctrl','control'].includes(name))cmd=true;
    else if(['alt','option','opt'].includes(name))alt=true;
    else if(name==='shift')shift=true;
    else if(key)return '';
    else key=part.length===1?part.toUpperCase():/^f\d+$/i.test(part)?'F'+part.slice(1):part.length?part[0].toUpperCase()+part.slice(1):'';
  }
  if(plus){if(key)return '';key='+';}
  if(!key)return '';
  return `${cmd?'Cmd+':''}${alt?'Alt+':''}${shift?'Shift+':''}${key}`;
}
export function reservedShortcut(value){const n=normalizeShortcut(value);return Boolean(n&&RESERVED.has(n));}
export function normalizeOverrides(value){
  const map=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={};
  for(const [id,shortcut] of Object.entries(map)){
    if(typeof id!=='string'||id.length>200)throw Error('Choose a listed command.');
    if(shortcut===''){out[id]='';continue;}
    const next=normalizeShortcut(shortcut);if(!next||reservedShortcut(next))throw Error('`'+shortcut+'` is not a valid shortcut.');
    out[id]=next;
  }
  return out;
}
export function normalizeAlternates(value){
  const map=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={};
  for(const [id,list] of Object.entries(map)){
    if(!Array.isArray(list)||list.length>MAX_ALTERNATES)throw Error('at most '+MAX_ALTERNATES+' alternate shortcuts');
    const keys=[];
    for(const shortcut of list){const next=normalizeShortcut(shortcut);if(!next||reservedShortcut(next)||keys.includes(next))continue;keys.push(next);}
    out[id]=keys;
  }
  return out;
}
export function normalizeToolbarHidden(value){
  const list=Array.isArray(value)?value:[];
  if(list.some(name=>typeof name!=='string'||!TOOL_IDS.has(name)))throw Error('Choose a listed tool.');
  return [...new Set(list)];
}
export function setName(name){
  const n=String(name??'').trim();
  if(!n)throw Error('a set needs a name');
  if([...n].length>MAX_NAME)throw Error('a set name is at most '+MAX_NAME+' characters');
  if([...n].some(ch=>ch.charCodeAt(0)<32))throw Error("a set name can't contain control characters");
  if(n.toLowerCase()==='photocraft defaults')throw Error('`PhotoCraft Defaults` is the built-in set');
  return n;
}
export function normalizeShortcutSets(value){
  const map=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const names=Object.keys(map);
  if(names.length>MAX_SETS)throw Error('at most '+MAX_SETS+' shortcut sets');
  const out={};
  for(const name of names){const checked=setName(name),set=map[name]||{};out[checked]={shortcuts:normalizeOverrides(set.shortcuts),alternates:normalizeAlternates(set.alternates)};}
  return out;
}
export function toolbarRuntimeIds(hidden){const names=new Set(normalizeToolbarHidden(hidden));return new Set(TOOLBAR_TOOLS.filter(row=>names.has(row[0])).map(row=>row[3]));}
function commandRows(menus){
  const rows=menuLeaves(menus).map(item=>({id:item.id,label:item.label,path:item.path,shortcut:item.shortcut||''}));
  for(const [id,label,shortcut] of TEMPORARY)rows.push({id,label,path:['Tools','Temporary'],shortcut});
  for(const [,label,key,id] of TOOLBAR_TOOLS)rows.push({id:'tool.select.'+id,label,path:['Tools'],shortcut:key});
  return rows;
}
export function effectiveShortcut(prefs,id,fallback=''){
  const overrides=normalizeOverrides(prefs?.shortcutOverrides);
  if(Object.hasOwn(overrides,id))return overrides[id];
  return normalizeShortcut(fallback);
}
export function bindingForEvent(prefs,menus,event){
  const typed=eventShortcut(event);
  if(!typed)return '';
  const overrides=normalizeOverrides(prefs?.shortcutOverrides),alternates=normalizeAlternates(prefs?.shortcutAlternates);
  for(const [id,shortcut] of Object.entries(overrides))if(shortcut&&shortcut===typed)return id;
  for(const [id,list] of Object.entries(alternates))if(list.includes(typed))return id;
  for(const row of commandRows(menus))if(!row.id.startsWith('tool.select.')&&!row.id.startsWith('tools.temporary.')&&!Object.hasOwn(overrides,row.id)&&normalizeShortcut(row.shortcut)===typed)return row.id;
  return '';
}
export function eventShortcut(event){
  if(!event||['Control','Shift','Alt','Meta'].includes(event.key))return '';
  let key=event.key===' '?'Space':event.key;
  if(key==='Esc')key='Escape';
  if(key.length===1)key=key.toUpperCase();
  else if(/^f\d+$/i.test(key))key='F'+key.slice(1);
  return normalizeShortcut(`${event.metaKey||event.ctrlKey?'Cmd+':''}${event.altKey?'Alt+':''}${event.shiftKey?'Shift+':''}${key}`);
}
function holders(rows,overrides,alternates,selected,shortcut){
  const found=[];
  for(const row of rows){
    if(row.id===selected)continue;
    const main=Object.hasOwn(overrides,row.id)?overrides[row.id]:normalizeShortcut(row.shortcut);
    const extra=alternates[row.id]||[];
    if(main===shortcut||extra.includes(shortcut))found.push(row);
  }
  return found;
}
function downloadText(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function escapeXml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));}
export function writeKys(name,rows,overrides,alternates){
  const commands=rows.filter(row=>!row.id.startsWith('tool.select.')).map(row=>{const main=Object.hasOwn(overrides,row.id)?overrides[row.id]:normalizeShortcut(row.shortcut);const keys=[main,...(alternates[row.id]||[])].filter(Boolean);return keys.length?`<command name="${escapeXml(row.label)}" pc-id="${escapeXml(row.id)}">${keys.map(key=>`<shortcut>${escapeXml(key)}</shortcut>`).join('')}</command>`:''}).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<photoshop-keyboard-shortcuts filename="${escapeXml(name)}">\n${commands.join('\n')}\n</photoshop-keyboard-shortcuts>\n`;
}
export function readKys(text,rows){
  if(String(text).length>4<<20)throw Error('not a keyboard shortcut set (.kys): larger than 4 MiB');
  if(!text.includes('<photoshop-keyboard-shortcuts'))throw Error('not a keyboard shortcut set (.kys)');
  const overrides={},alternates={};
  for(const block of text.matchAll(/<command\b([^>]*)>([\s\S]*?)<\/command>/g)){
    const id=(block[1].match(/pc-id="([^"]*)"/)||[])[1];
    const label=(block[1].match(/\bname="([^"]*)"/)||[])[1]||'';
    const keys=[...block[2].matchAll(/<shortcut>([^<]*)<\/shortcut>/g)].map(item=>normalizeShortcut(item[1].replace(/Control/g,'Ctrl').replace(/Opt/g,'Alt'))).filter(Boolean);
    const row=rows.find(item=>item.id===id)||rows.find(item=>item.label.replace(/…/g,'...')===label.replace(/…/g,'...'));
    if(!row||!keys.length)continue;
    overrides[row.id]=keys[0];
    if(keys.length>1)alternates[row.id]=keys.slice(1,MAX_ALTERNATES+1);
  }
  return {overrides,alternates};
}
export function summarizeShortcuts(name,rows,overrides,alternates,mac){
  const sections=new Map();
  for(const row of rows){
    const main=Object.hasOwn(overrides,row.id)?overrides[row.id]:normalizeShortcut(row.shortcut);
    const keys=[main,...(alternates[row.id]||[])].filter(Boolean).map(key=>mac?key.replaceAll('Cmd+','⌘').replaceAll('Shift+','⇧').replaceAll('Alt+','⌥'):key);
    if(!keys.length)continue;
    const title=row.path[0]||'Other';
    const label=[...row.path.slice(1),row.label].join(' › ');
    if(!sections.has(title))sections.set(title,[]);
    sections.get(title).push([label,keys]);
  }
  const esc=value=>String(value).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
  let html='<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>'+esc(name)+'</title>\n<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse;margin-bottom:2em}th,td{border:1px solid #bbb;padding:4px 10px;text-align:left}th{background:#eee}</style>\n</head><body>\n<h1>'+esc(name)+'</h1>\n';
  for(const [title,items] of sections){html+=`<h2>${esc(title)}</h2>\n<table><tr><th>Command</th><th>Shortcut</th></tr>\n`;for(const [label,keys] of items)html+=`<tr><td>${esc(label)}</td><td>${esc(keys.join(', '))}</td></tr>\n`;html+='</table>\n';}
  return html+'</body></html>\n';
}
export function mountShortcutWindow(body,menus,prefs,initial=0){
  const rows=commandRows(menus).map(row=>({...row,shortcut:row.shortcut||menuLeaves(menus).find(item=>item.id===row.id)?.shortcut||row.shortcut}));
  const leaves=menuLeaves(menus);
  for(const row of rows){const leaf=leaves.find(item=>item.id===row.id);if(leaf?.shortcut)row.shortcut=leaf.shortcut;}
  const draft={overrides:normalizeOverrides(prefs?.shortcutOverrides),alternates:normalizeAlternates(prefs?.shortcutAlternates),sets:normalizeShortcutSets(prefs?.shortcutSets),active:prefs?.shortcutSet||'',hidden:normalizeMenuHidden(prefs?.menuHidden),colors:normalizeMenuColors(prefs?.menuColors),toolbar:normalizeToolbarHidden(prefs?.toolbarHidden),tab:initial,selected:'',capture:false,captureAlt:false,conflict:null,message:'',warning:false,newName:null};
  if(draft.active&&!draft.sets[draft.active])draft.active='';
  const tabs=document.createElement('div');tabs.className='shortcut-tabs';
  const search=document.createElement('input');search.type='search';search.placeholder='command or shortcut';search.setAttribute('aria-label','Search');
  const setRow=document.createElement('div');setRow.className='shortcut-set-row';
  const list=document.createElement('div');list.className='menu-editor-list';
  const actions=document.createElement('div');actions.className='shortcut-actions';
  const message=document.createElement('p');message.setAttribute('role','status');
  const names=['Keyboard Shortcuts','Menus','Toolbar'];
  const buttons=names.map((label,index)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>{draft.tab=index;draft.capture=false;paint();};return button;});
  tabs.append(...buttons);
  function currentMain(id,fallback){return Object.hasOwn(draft.overrides,id)?draft.overrides[id]:normalizeShortcut(fallback);}
  function showMessage(text,warning=false){draft.message=text;draft.warning=warning;}
  function paint(){
    buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(draft.tab===index)));
    setRow.replaceChildren();actions.replaceChildren();list.replaceChildren();
    if(draft.tab===0){
      const now={shortcuts:draft.overrides,alternates:draft.alternates};
      const saved=draft.active?draft.sets[draft.active]:null;
      const modified=saved?JSON.stringify(saved)!==JSON.stringify(now):JSON.stringify(now)!==JSON.stringify({shortcuts:{},alternates:{}});
      const select=document.createElement('select');select.setAttribute('aria-label','Set');
      const option=document.createElement('option');option.value='';option.textContent=modified&&!draft.active?'PhotoCraft Defaults (modified)':'PhotoCraft Defaults';select.append(option);
      for(const name of Object.keys(draft.sets)){const item=document.createElement('option');item.value=name;item.textContent=name===draft.active&&modified?name+' (modified)':name;select.append(item);}
      select.value=draft.active;select.onchange=()=>{const chosen=select.value,set=chosen?draft.sets[chosen]:{shortcuts:{},alternates:{}};draft.overrides={...set.shortcuts};draft.alternates={...set.alternates};draft.active=chosen;draft.conflict=null;showMessage('');paint();};
      const add=(label,enabled,run)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=!enabled;button.onclick=run;return button;};
      setRow.append(select,add('New Set…',true,()=>{draft.newName='';paint();}),add('Save',Boolean(draft.active&&modified),()=>{draft.sets[draft.active]={shortcuts:{...draft.overrides},alternates:{...draft.alternates}};showMessage('Set saved.');paint();}),add('Delete',Boolean(draft.active),()=>{delete draft.sets[draft.active];draft.active='';showMessage('Set deleted.');paint();}),add('Export…',true,()=>{downloadText((draft.active||'PhotoCraft Defaults')+'.kys',writeKys(draft.active||'PhotoCraft Defaults',rows,draft.overrides,draft.alternates),'application/xml');}),add('Summarize…',true,()=>{downloadText((draft.active||'PhotoCraft Defaults')+'.html',summarizeShortcuts(draft.active||'PhotoCraft Defaults',rows,draft.overrides,draft.alternates,/Mac/i.test(navigator.platform)),'text/html');}));
      const file=document.createElement('input');file.type='file';file.accept='.kys,.psp,text/xml';file.hidden=true;file.onchange=async()=>{try{const text=await file.files?.[0]?.text();if(!text)return;const read=readKys(text,rows);draft.overrides=read.overrides;draft.alternates=read.alternates;draft.conflict=null;showMessage('Shortcuts imported.');paint();}catch(error){showMessage(error.message,true);paint();}};
      setRow.append(add('Import Shortcuts…',true,()=>file.click()),file);
      if(draft.newName!==null){const name=document.createElement('input');name.value=draft.newName;name.placeholder='set name';name.setAttribute('aria-label','Name');name.oninput=()=>draft.newName=name.value;const create=add('Create',true,()=>{try{const checked=setName(draft.newName);if(draft.sets[checked])throw Error('a set with that name already exists');if(Object.keys(draft.sets).length>=MAX_SETS)throw Error('There are too many sets: delete one first.');draft.sets[checked]={shortcuts:{...draft.overrides},alternates:{...draft.alternates}};draft.active=checked;draft.newName=null;showMessage('Set saved.');}catch(error){showMessage(error.message,true);}paint();});setRow.append(name,create,add('Cancel',true,()=>{draft.newName=null;paint();}));}
    }
    const needle=search.value.trim().toLowerCase();
    if(draft.tab===2){
      for(const [name,label,key] of TOOLBAR_TOOLS){const row=document.createElement('label');row.className='menu-editor-row';const input=document.createElement('input');input.type='checkbox';input.checked=!draft.toolbar.includes(name);input.onchange=()=>{draft.toolbar=input.checked?draft.toolbar.filter(item=>item!==name):[...draft.toolbar,name];};row.append(input,document.createTextNode(label),document.createTextNode(key));list.append(row);}
      actions.append(button('Restore Defaults',()=>{draft.toolbar=[];paint();}));
    }else{
      let last='';
      for(const row of rows){
        if(draft.tab===1&&row.id.startsWith('tool.select.'))continue;
        const main=currentMain(row.id,row.shortcut),extra=draft.alternates[row.id]||[];
        const hay=`${row.path.join(' ')} ${row.label} ${row.id} ${main} ${extra.join(' ')}`.toLowerCase();
        if(needle&&!hay.includes(needle))continue;
        const top=row.path[0]||'Other';
        if(top!==last){const heading=document.createElement('h4');heading.textContent=top;list.append(heading);last=top;}
        const line=document.createElement('div');line.className='menu-editor-row';
        const name=document.createElement('button');name.type='button';name.className='shortcut-command';name.textContent=`${row.path.slice(1).join(' › ')}${row.path.length>1?' › ':''}${row.label}`;name.onclick=()=>{draft.selected=row.id;paint();};
        line.append(name);
        if(draft.tab===0){
          const key=document.createElement('button');key.type='button';key.textContent=draft.selected===row.id&&draft.capture&&!draft.captureAlt?'Press keys…':main||'';key.onclick=()=>{draft.selected=row.id;draft.capture=true;draft.captureAlt=false;showMessage('');paint();};
          const more=document.createElement('span');
          for(const item of extra){const remove=document.createElement('button');remove.type='button';remove.textContent=item+'  ×';remove.onclick=()=>{draft.alternates[row.id]=extra.filter(key=>key!==item);draft.selected=row.id;showMessage('Shortcut removed.');paint();};more.append(remove);}
          if(draft.selected===row.id&&draft.capture&&draft.captureAlt)more.append(document.createTextNode('Press keys…'));
          line.append(key,more);
        }else{
          const hideable=menuHideable(row.id),visible=document.createElement('input');visible.type='checkbox';visible.checked=!hideable||!draft.hidden.includes(row.id);visible.disabled=!hideable;visible.setAttribute('aria-label','Visible');visible.onchange=()=>{if(visible.checked)draft.hidden=draft.hidden.filter(id=>id!==row.id);else draft.hidden.push(row.id);};
          const color=document.createElement('select');color.setAttribute('aria-label','Color');
          for(const choice of COLORS){const option=document.createElement('option');option.value=choice;option.textContent=choice;color.append(option);}color.value=draft.colors[row.id]||'none';color.onchange=()=>{if(color.value==='none')delete draft.colors[row.id];else draft.colors[row.id]=color.value;};
          const label=document.createElement('label');label.append(visible,document.createTextNode('Visible'));line.append(label,color);
        }
        list.append(line);
      }
      if(draft.tab===0){
        const selected=draft.selected;
        actions.append(button('Add Shortcut',()=>{draft.capture=true;draft.captureAlt=true;showMessage('');paint();},!selected),button('Use Default',()=>{delete draft.overrides[selected];delete draft.alternates[selected];showMessage('Default restored.');paint();},!selected),button('Delete Shortcut',()=>{draft.overrides[selected]='';showMessage('Shortcut removed.');paint();},!selected),button('Reset All to Defaults',()=>{draft.overrides={};draft.alternates={};showMessage('All shortcuts reset to PhotoCraft defaults.');paint();}));
        if(draft.conflict){
          actions.append(button('Accept and Go to Conflict',()=>{const conflict=draft.conflict;for(const holder of conflict.holders){if(currentMain(holder.id,holder.shortcut)===conflict.shortcut)draft.overrides[holder.id]='';const keys=draft.alternates[holder.id]||[];if(keys.includes(conflict.shortcut))draft.alternates[holder.id]=keys.filter(key=>key!==conflict.shortcut);}draft.selected=conflict.with;search.value='';draft.conflict=null;showMessage('Choose a new shortcut for this command, or leave it without one.');paint();}),button('Undo Changes',()=>{const conflict=draft.conflict;if(conflict.main===undefined)delete draft.overrides[conflict.command];else draft.overrides[conflict.command]=conflict.main;if(conflict.alternates)draft.alternates[conflict.command]=conflict.alternates;else delete draft.alternates[conflict.command];draft.selected=conflict.command;draft.conflict=null;showMessage('Changes undone.');paint();}));
        }
      }else actions.append(button('Show All Menu Items',()=>{draft.hidden=[];draft.colors={};paint();}));
    }
    message.textContent=draft.message;message.hidden=!draft.message;
  }
  function button(label,run,disabled=false){const item=document.createElement('button');item.type='button';item.textContent=label;item.disabled=disabled;item.onclick=run;return item;}
  function assign(shortcut){
    const row=rows.find(item=>item.id===draft.selected);if(!row)return;
    const found=holders(rows,draft.overrides,draft.alternates,draft.selected,shortcut);
    draft.conflict=found.length?{shortcut,with:found[0].id,holders:found,command:draft.selected,main:Object.hasOwn(draft.overrides,draft.selected)?draft.overrides[draft.selected]:undefined,alternates:draft.alternates[draft.selected]?draft.alternates[draft.selected].slice():undefined}:null;
    if(draft.captureAlt){const keys=draft.alternates[draft.selected]||[];const main=currentMain(draft.selected,row.shortcut);if(main!==shortcut&&!keys.includes(shortcut)&&keys.length<MAX_ALTERNATES)draft.alternates[draft.selected]=[...keys,shortcut];}
    else draft.overrides[draft.selected]=shortcut;
    draft.capture=false;
    showMessage(found.length?shortcut+' is already in use by '+found.map(item=>item.label).join(', ')+' and will be removed from it when you click OK.':shortcut+' assigned.',Boolean(found.length));
  }
  const onKey=event=>{
    if(draft.tab!==0||!draft.capture||!draft.selected)return;
    if(['Control','Shift','Alt','Meta'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    if(event.key==='Escape'){draft.capture=false;draft.conflict=null;paint();return;}
    if(['Backspace','Delete'].includes(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){if(draft.captureAlt)draft.alternates[draft.selected]=[];else draft.overrides[draft.selected]='';draft.capture=false;showMessage('Shortcut removed.');paint();return;}
    const shortcut=eventShortcut(event);
    if(!shortcut)return;
    if(reservedShortcut(shortcut)){draft.capture=false;showMessage(shortcut+' is reserved by the system and can\'t be assigned.',true);paint();return;}
    assign(shortcut);paint();
  };
  body.append(tabs,setRow,search,list,actions,message);
  body.addEventListener('keydown',onKey,true);
  search.oninput=paint;paint();
  return ()=>{
    const overrides={...draft.overrides},alternates={...draft.alternates};
    for(const [id,shortcut] of Object.entries(overrides))if(shortcut)for(const row of rows){if(row.id===id)continue;const own=Object.hasOwn(overrides,row.id);if(own&&overrides[row.id]===shortcut)overrides[row.id]='';const keys=alternates[row.id]||[];if(keys.includes(shortcut))alternates[row.id]=keys.filter(key=>key!==shortcut);}
    return {shortcutOverrides:overrides,shortcutAlternates:alternates,shortcutSets:draft.sets,shortcutSet:draft.active,menuHidden:draft.hidden.slice(),menuColors:{...draft.colors},toolbarHidden:draft.toolbar.slice()};
  };
}
