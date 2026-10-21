export function notePanelIndex(current,count){if(!count)return null;if(current==null||current<0||current>=count)return 0;return current;}
export function noteAfterDelete(index,countBefore){return countBefore>1?Math.min(index,countBefore-2):null;}
export function notesPanelOpen(){const panel=document.getElementById('notes-panel');return Boolean(panel&&!panel.hidden);}
export function openNotesPanel({getDocument,getIndex,setIndex,redraw}){
  const existing=document.getElementById('notes-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;
  if(!panel){panel=document.createElement('section');panel.id='notes-panel';panel.style.cssText='position:fixed;right:48px;top:300px;z-index:40;width:260px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  const button=(text,on,enabled=true)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.disabled=!enabled;node.onclick=on;return node;};
  const paint=()=>{
    const documentNotes=getDocument()?.notes||[],count=documentNotes.length,index=notePanelIndex(getIndex(),count);
    setIndex(index);
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Notes';title.append(name,button('×',()=>{panel.hidden=true;}));
    const body=document.createElement('div');
    if(index==null){const empty=document.createElement('div');empty.textContent='Click with the Note tool to add a note.';empty.style.color='#aaa';body.append(empty);}
    else{const note=documentNotes[index],author=document.createElement('div');author.textContent=note.author?note.author:'No author';author.style.color='#aaa';const text=document.createElement('textarea');text.rows=6;text.style.width='100%';text.value=note.text;text.onchange=()=>{const current=getDocument();if(!current?.notes[index])return;current.setNote(index,{text:text.value});redraw?.();paint();};body.append(author,text);}
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:4px;align-items:center';
    bar.append(button('Previous',()=>{setIndex((index+count-1)%count);paint();},count>1),button('Next',()=>{setIndex((index+1)%count);paint();},count>1));
    const position=document.createElement('span');position.textContent=`${index==null?0:index+1} of ${count}`;position.style.color='#aaa';
    bar.append(position,button('Delete',()=>{const current=getDocument();if(index==null||!current?.notes[index])return;current.deleteNote(index);setIndex(noteAfterDelete(index,count));redraw?.();paint();},index!=null));
    panel.replaceChildren(title,body,bar);
  };
  panel._paint=paint;paint();
}
