import {bindAttribute} from './i18n.js';
const localizedFontNames=new Map();let englishFontNames=true;
export function registerFontLabels(entries){for(const entry of entries)if(typeof entry.family==='string'&&typeof entry.localizedFamily==='string'&&entry.localizedFamily.trim()&&!localizedFontNames.has(entry.family))localizedFontNames.set(entry.family,entry.localizedFamily);}
export function setEnglishFontNames(value){englishFontNames=value!==false;}
export function fontMenuLabel(family){return englishFontNames?family:localizedFontNames.get(family)||family;}
const recentFamilies=[];let saveRecent=()=>{};
export function restoreRecentFonts(storage,onError=()=>{}){
  const key='chameleon.photoEditor.recentFonts';saveRecent=()=>{};
  try{const raw=storage.getItem(key),saved=raw===null?[]:JSON.parse(raw);
    if(!Array.isArray(saved)||saved.length>50||saved.some(name=>typeof name!=='string'||!name||name.length>256||/[\x00-\x1f]/.test(name)))throw Error('Invalid recent font list.');
    recentFamilies.splice(0,recentFamilies.length,...new Set(saved));
    saveRecent=()=>{try{storage.setItem(key,JSON.stringify(recentFamilies));}catch(error){saveRecent=()=>{};onError(error);}};
  }catch(error){onError(error);}
}

export function rememberFontFamily(family){if(typeof family!=='string'||!family||family.length>256||/[\x00-\x1f]/.test(family))return;const index=recentFamilies.indexOf(family);if(index>=0)recentFamilies.splice(index,1);recentFamilies.unshift(family);recentFamilies.length=Math.min(50,recentFamilies.length);saveRecent();}
export function fontMatches(family,query){const q=String(query).toLowerCase();return family.toLowerCase().includes(q)||fontMenuLabel(family).toLowerCase().includes(q);}
export function orderFontOptions(options,limit=10){const count=Number.isInteger(limit)?Math.max(0,Math.min(50,limit)):10;const priority=recentFamilies.slice(0,count),base=[...options];if(!englishFontNames&&localizedFontNames.size)base.sort((a,b)=>{const x=fontMenuLabel(a.value).toLowerCase(),y=fontMenuLabel(b.value).toLowerCase();return x<y?-1:x>y?1:0;});return base.map((option,index)=>({option,index,rank:priority.indexOf(option.value)})).sort((a,b)=>(a.rank<0?Infinity:a.rank)-(b.rank<0?Infinity:b.rank)||a.index-b.index).map(entry=>entry.option);}
// Source geometry: ui-egui/src/font_preview.rs. Only display a successfully loaded face.
export function fontPreviewGeometry(value){
  const size={small:14,medium:18,large:24,extraLarge:32,huge:40}[value];
  return size?{size,width:Math.round(100*size/18),height:Math.round(24*size/18)}:null;
}
export function mountFontPreview(select,value,loadFont,recentLimit=10){
  const geometry=fontPreviewGeometry(value);
  if(!select)return()=>{};
  const document=select.ownerDocument,menu=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('div');
  menu.className='font-preview-picker';summary.textContent=fontMenuLabel(select.value)||select.selectedOptions[0]?.textContent||select.value;list.className='font-preview-list';
  const search=document.createElement('input');search.type='search';bindAttribute(search,'placeholder','Search fonts');bindAttribute(search,'aria-label','Search fonts');search.className='font-preview-search';list.append(search);
  menu.append(summary,list);select.after(menu);const wasHidden=select.hidden;select.hidden=true;let disposed=false;
  const pending=new Set(),rows=[];
  const loaded=family=>[...document.fonts].some(face=>face.status==='loaded'&&face.family.replace(/^["']|["']$/g,'')===family);
  for(const option of select.options){
    const row=document.createElement('button'),name=document.createElement('span'),sample=document.createElement('span');row.type='button';row.disabled=option.disabled;row.className='font-preview-row';name.textContent=option.value?fontMenuLabel(option.value):option.textContent;
    sample.textContent='AaBbCc';sample.hidden=!geometry;sample.setAttribute('aria-hidden','true');Object.assign(sample.style,{visibility:'hidden',fontSize:(geometry?.size||18)+'px',width:(geometry?.width||100)+'px',height:(geometry?.height||24)+'px',lineHeight:(geometry?.height||24)+'px'});row.append(name,sample);list.append(row);rows.push([option,row]);
    const paint=()=>{if(!geometry||disposed||!loaded(option.value))return;sample.style.fontFamily=JSON.stringify(option.value);sample.style.visibility='visible';};
    const preview=async()=>{if(!geometry||!option.value)return;if(pending.has(row)||loaded(option.value)){paint();return;}pending.add(row);try{await loadFont(option.value,geometry.size);paint();}catch{/* Keep the label without a fallback sample. */}finally{pending.delete(row);}};
    row.addEventListener('pointerenter',preview);row.addEventListener('focus',preview);paint();
    row.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));menu.open=false;summary.focus();};
    row.onkeydown=event=>{let index=rows.findIndex(([,button])=>button===row);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const direction=event.key==='ArrowDown'?1:-1;for(let n=0;n<rows.length;n++){index=(index+direction+rows.length)%rows.length;if(!rows[index][1].disabled&&!rows[index][1].hidden){rows[index][1].focus();break;}}}if(event.key==='Escape'){event.preventDefault();menu.open=false;summary.focus();}};
  }
  const filter=()=>{for(const [option,row]of rows)row.hidden=!fontMatches(option.value,search.value);position();};search.addEventListener('input',filter);search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();rows.find(([,row])=>!row.hidden&&!row.disabled)?.[1].focus();}});
  const sync=()=>{summary.textContent=fontMenuLabel(select.value)||select.selectedOptions[0]?.textContent||select.value;for(const [option,row]of rows)row.setAttribute('aria-pressed',String(option.value===select.value));};
  const position=()=>{
    if(!menu.open||!menu.classList.contains('toolbar-font-picker'))return;
    const view=document.defaultView,anchor=summary.getBoundingClientRect(),scale=menu.offsetWidth?menu.getBoundingClientRect().width/menu.offsetWidth:1;
    if(!scale||!view)return;
    const width=Math.min(view.innerWidth,document.documentElement.clientWidth),height=Math.min(view.innerHeight,document.documentElement.clientHeight);
    list.style.left='0px';list.style.top='100%';list.style.maxWidth=Math.max(0,(width-16)/scale)+'px';
    const below=Math.max(0,height-anchor.bottom-8),above=Math.max(0,anchor.top-8),up=below<120&&above>below;
    list.style.maxHeight=Math.min(240,(up?above:below)/scale)+'px';
    const rect=list.getBoundingClientRect(),shift=Math.min(0,width-8-rect.right)+Math.max(0,8-rect.left);
    list.style.left=shift/scale+'px';if(up)list.style.top=-(rect.height/scale)+'px';
  };
  const toggle=()=>{if(menu.open){search.value='';for(const [,row]of rows)row.hidden=false;const ordered=orderFontOptions(select.options,recentLimit);rows.sort((a,b)=>ordered.indexOf(a[0])-ordered.indexOf(b[0]));for(const [,row]of rows)list.append(row);sync();(rows.find(([option])=>option.value===select.value)?.[1])?.focus();position();}};
  const onScroll=event=>{if(!list.contains(event.target))position();};
  const view=document.defaultView;view?.addEventListener('resize',position);document.addEventListener('scroll',onScroll,true);
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();menu.open=false;summary.focus();}});
  const outside=event=>{if(!menu.contains(event.target))menu.open=false;};
  const changed=()=>{rememberFontFamily(select.value);sync();};select.addEventListener('change',changed);menu.addEventListener('toggle',toggle);document.addEventListener('pointerdown',outside);sync();
  return()=>{disposed=true;view?.removeEventListener('resize',position);document.removeEventListener('scroll',onScroll,true);select.hidden=wasHidden;select.removeEventListener('change',changed);document.removeEventListener('pointerdown',outside);menu.removeEventListener('toggle',toggle);menu.remove();};
}
