const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
const structuredPreferences=new Set(['menuHidden','menuColors','shortcutOverrides','shortcutAlternates','shortcutSets','toolbarHidden']);
function validStructure(value,depth=0){
  if(typeof value==='string')return value.length<=4096;
  if(!value||typeof value!=='object'||depth>=4)return false;
  if(Array.isArray(value))return value.length<=5000&&value.every(item=>validStructure(item,depth+1));
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const entries=Object.entries(value);
  return entries.length<=5000&&entries.every(([key,item])=>key.length<=200&&!['__proto__','prototype','constructor'].includes(key)&&validStructure(item,depth+1));
}
function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>200)throw Error('Invalid Photo Editor preferences.');const text=JSON.stringify(value);if(Buffer.byteLength(text)>65536)throw Error('Photo Editor preferences exceed 64 KiB.');for(const [key,item]of Object.entries(value)){const primitive=['string','number','boolean'].includes(typeof item)&&(typeof item!=='number'||Number.isFinite(item));if(!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)||!(primitive||structuredPreferences.has(key)&&validStructure(item)))throw Error('Invalid Photo Editor preference value.');}return text;}
function createSettingsStore(directory,filename='preferences.json'){if(!['preferences.json','workspace.json','recent.json'].includes(filename))throw Error('Invalid settings filename.');const file=path.join(directory,filename);let queue=Promise.resolve();function run(task){const next=queue.then(task);queue=next.catch(()=>{});return next;}return{read:()=>run(async()=>{let info;try{info=await fs.stat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}if(!info.isFile()||info.size>65536)throw Error('Invalid Photo Editor preferences file.');const value=JSON.parse(await fs.readFile(file,'utf8'));validate(value);return value;}),write:value=>run(async()=>{const text=validate(value);await fs.mkdir(directory,{recursive:true,mode:0o700});const temporary=path.join(directory,'preferences-'+randomUUID()+'.tmp');let handle;try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(text,'utf8');await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);}finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});}return true;})};}
module.exports={createSettingsStore};
