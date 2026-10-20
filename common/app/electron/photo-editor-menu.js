const {Menu,app}=require('electron');
const nativeTitle=process.platform==='darwin'?require('./photo-editor-menu-name.node'):null;
function installEditorMenu(contents){
  const previous=Menu.getApplicationMenu(),previousName=app.getName();app.setName('Photo Editor');let signature='',allowed=new Set(),disposed=false,nativeRevision=0;const timers=new Set();
  function applyNative(save){const revision=++nativeRevision;for(const timer of timers)clearTimeout(timer);timers.clear();for(const delay of [0,100,350]){const timer=setTimeout(()=>{timers.delete(timer);if(disposed||revision!==nativeRevision)return;nativeTitle?.setMenuTitle('Photo Editor');if(save)nativeTitle?.setSaveAction(save.enabled!==false,()=>{if(!disposed&&!contents.isDestroyed())contents.send('grok-chameleon:photo-editor-menu-command','file.saveToApp');});},delay);timers.add(timer);}}
  function update(event,model){
    if(disposed||event.sender!==contents||!Array.isArray(model)||model.length>16)return;
    const encoded=JSON.stringify(model);if(encoded.length>300000)throw Error('Editor menu is too large.');if(encoded===signature)return;
    const nextAllowed=new Set();
    const convert=(rows,depth=0)=>{if(depth>10||!Array.isArray(rows)||rows.length>2000)throw Error('Invalid editor menu.');return rows.map(row=>{
      if(row.type==='separator')return{type:'separator'};
      if(typeof row.label!=='string'||row.label.length>300)throw Error('Invalid editor menu label.');
      if(row.role){if(!['services','hide','hideOthers','unhide'].includes(row.role))throw Error('Invalid editor menu role.');return{label:row.label,role:row.role,...(row.accelerator?{accelerator:row.accelerator}:{})};}
      const item={label:row.label,enabled:row.enabled!==false};
      if(row.submenu)item.submenu=convert(row.submenu,depth+1);
      else{if(typeof row.command!=='string'||row.command.length>240)throw Error('Invalid editor menu command.');nextAllowed.add(row.command);item.click=()=>{if(!disposed&&!contents.isDestroyed()&&allowed.has(row.command))contents.send('grok-chameleon:photo-editor-menu-command',row.command);};if(row.accelerator)item.accelerator=row.accelerator;}
      if(typeof row.checked==='boolean'){item.type='checkbox';item.checked=row.checked;}
      return item;
    });};
    const save=model.at(-1)?.label==='Save to App'?model.at(-1):null;
    const menu=Menu.buildFromTemplate(convert(save?model.slice(0,-1):model));allowed=nextAllowed;signature=encoded;Menu.setApplicationMenu(menu);applyNative(save);
  }
  return{update,dispose(){if(disposed)return;disposed=true;for(const timer of timers)clearTimeout(timer);timers.clear();allowed.clear();nativeTitle?.clearSaveAction();app.setName(previousName);Menu.setApplicationMenu(previous);nativeTitle?.setMenuTitle(previousName);}};
}
module.exports={installEditorMenu};
