import {glyphCategories,glyphsFor} from './glyph-text.js';
const recent=[];
export function glyphsPanelOpen(){const panel=document.getElementById('glyphs-panel');return Boolean(panel&&!panel.hidden);}
export function openGlyphsPanel({getDocument,insert}){
  let panel=document.getElementById('glyphs-panel');
  if(panel&&!panel.hidden){panel.hidden=true;return;}
  if(!panel){panel=document.createElement('section');panel.id='glyphs-panel';panel.style.cssText='position:fixed;right:16px;top:72px;z-index:40;width:340px;max-height:420px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;box-shadow:0 8px 24px #0008';document.body.append(panel);}
  panel.hidden=false;
  const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between;align-items:center';
  const name=document.createElement('strong');name.textContent='Glyphs';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.onclick=()=>{panel.hidden=true;};
  title.append(name,close);
  const show=document.createElement('select');
  for(const category of glyphCategories){const option=document.createElement('option');option.value=category;option.textContent=category;show.append(option);}
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(8,1fr);gap:2px;overflow:auto;max-height:300px';
  const paint=()=>{grid.replaceChildren();for(const glyph of glyphsFor(show.value)){const button=document.createElement('button');button.type='button';button.textContent=glyph;button.style.cssText='height:32px;background:#1d1d1d;color:#eee;border:1px solid #444';button.ondblclick=()=>{insert(glyph);if(!recent.includes(glyph))recent.unshift(glyph);recent.splice(12);};grid.append(button);}};
  show.onchange=paint;paint();
  const used=document.createElement('div');used.textContent='Recently Used: '+(recent.join(' ')||'—');
  panel.replaceChildren(title,show,used,grid);
}
