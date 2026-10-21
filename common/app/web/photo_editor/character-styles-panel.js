import {applyCharacterAttrs,characterStyles,deleteCharacterStyle,duplicateCharacterStyle,listCharacterStyles,newCharacterStyle,renameCharacterStyle} from './character-style.js';
export function characterStylesPanelOpen(){const panel=document.getElementById('character-styles-panel');return Boolean(panel&&!panel.hidden);}
export function openCharacterStylesPanel({getDocument,onApply}){
  const existing=document.getElementById('character-styles-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  const doc=getDocument();if(!doc)throw Error('Open a document first.');
  let panel=document.getElementById('character-styles-panel');
  if(!panel){panel=document.createElement('section');panel.id='character-styles-panel';panel.style.cssText='position:fixed;right:16px;top:72px;z-index:40;width:260px;max-height:360px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555';document.body.append(panel);}
  panel.hidden=false;
  const styles=characterStyles(doc),rows=document.createElement('div');rows.style.cssText='overflow:auto;max-height:240px';
  let selected=0;
  const paint=()=>{rows.replaceChildren();for(const style of listCharacterStyles(styles)){const button=document.createElement('button');button.type='button';button.textContent=style.name;button.style.cssText='display:block;width:100%;text-align:left;background:'+(style.id===selected?'#3a5':'#1d1d1d')+';color:#eee;border:0;padding:4px 6px';button.onclick=()=>{selected=style.id;paint();};rows.append(button);}};
  const bar=document.createElement('div');
  const add=document.createElement('button');add.type='button';add.textContent='New';add.onclick=()=>{const layer=doc.active,attrs={};if(layer?.text){if(layer.text.size)attrs.size=layer.text.size;if(layer.text.font)attrs.font_family=layer.text.font;}doc.checkpoint('New Character Style');const created=newCharacterStyle(styles,{attrs});selected=created.id;doc.changed();paint();};
  const apply=document.createElement('button');apply.type='button';apply.textContent='Apply';apply.onclick=()=>{const layer=doc.active,style=listCharacterStyles(styles).find(item=>item.id===selected);if(!layer?.text)throw Error('the active layer is not a type layer');if(!style||style.id===0)return;onApply(applyCharacterAttrs(layer.text,style));};
  const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.onclick=()=>{doc.checkpoint('Delete Character Style');deleteCharacterStyle(styles,selected);selected=0;doc.changed();paint();};
  const rename=document.createElement('button');rename.type='button';rename.textContent='Rename';rename.onclick=()=>{const style=styles.find(item=>item.id===selected);if(!style)return;const name=window.prompt('Style name',style.name);if(!name)return;doc.checkpoint('Rename Character Style');renameCharacterStyle(styles,selected,name);doc.changed();paint();};
  const copy=document.createElement('button');copy.type='button';copy.textContent='Duplicate';copy.onclick=()=>{doc.checkpoint('Duplicate Style');const created=duplicateCharacterStyle(styles,selected);selected=created.id;doc.changed();paint();};
  bar.append(add,apply,remove,rename,copy);paint();
  const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const label=document.createElement('strong');label.textContent='Character Styles';const close=document.createElement('button');close.type='button';close.textContent='×';close.onclick=()=>{panel.hidden=true;};title.append(label,close);
  panel.replaceChildren(title,bar,rows);
}
