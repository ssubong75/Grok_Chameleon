const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const formats=new Set(['psd','psb','png','jpg','jpeg','webp','tif','tiff','gcphoto']);
function createFileSave({dialog,getContext}){
  const destinations=new Map();
  function context(event){const current=getContext();if(!current.view||!current.session||event.sender!==current.view.webContents)throw Error('Photo Editor session is unavailable.');return current;}
  return async(event,operation,value={})=>{
    const current=context(event);
    if(operation==='adopt'){
      if(typeof value.path!=='string'||!path.isAbsolute(value.path))return null;const extension=path.extname(value.path).slice(1).toLowerCase();if(!['psd','psb','gcphoto'].includes(extension))return null;
      const destination=await fs.promises.realpath(value.path),stat=await fs.promises.stat(destination);if(!stat.isFile())return null;if(context(event).session!==current.session)throw Error('Photo Editor session changed.');const token=randomUUID();destinations.set(token,{path:destination,session:current.session});return{token,name:path.basename(destination),extension};
    }
    if(operation==='choose'){
      const known=destinations.get(value.token),name=typeof value.name==='string'?path.basename(value.name):'Untitled.psd';
      const picked=await dialog.showSaveDialog(current.view.webContents.getOwnerBrowserWindow(),{title:value.copy?'Save a Copy':'Save As',defaultPath:known?.session===current.session?known.path:name,filters:[{name:'Photoshop',extensions:['psd']},{name:'Large Document Format',extensions:['psb']},{name:'PNG',extensions:['png']},{name:'JPEG',extensions:['jpg','jpeg']},{name:'TIFF',extensions:['tif','tiff']},{name:'WebP',extensions:['webp']},{name:'Photo Editor Project',extensions:['gcphoto']}]});
      if(picked.canceled||!picked.filePath)return{cancelled:true};if(context(event).session!==current.session)throw Error('Photo Editor session changed.');
      let destination=picked.filePath;if(!path.extname(destination))destination+=path.extname(name)||'.psd';if(value.lowercaseExtension)destination=destination.slice(0,-path.extname(destination).length)+path.extname(destination).toLowerCase();const extension=path.extname(destination).slice(1).toLowerCase();if(!formats.has(extension))throw Error('This file format requires the original engine.');
      const token=randomUUID();destinations.set(token,{path:destination,session:current.session});return{token,name:path.basename(destination),extension};
    }
    if(operation!=='write')throw Error('Unknown file save operation.');const destination=destinations.get(value.token);if(!destination||destination.session!==current.session)throw Error('Choose a save destination first.');
    const bytes=Buffer.from(value.bytes||[]);if(!bytes.length||bytes.length>512*1024*1024)throw Error('Invalid file size.');
    const temp=path.join(path.dirname(destination.path),'.'+path.basename(destination.path)+'.'+randomUUID()+'.tmp');let handle;
    try{handle=await fs.promises.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;if(context(event).session!==current.session)throw Error('Photo Editor session changed.');await fs.promises.rename(temp,destination.path);}finally{await handle?.close();await fs.promises.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    return{saved:true};
  };
}
module.exports={createFileSave};
