// Local session-authorized linked source metadata; source smart_cmds relink/refresh semantics.
export function smartLinkRecord(value){
  if(value==null)return null;
  if(!value||typeof value.path!=='string'||!value.path.startsWith('/')||value.path.length>32768||value.path.includes('\0')||typeof value.name!=='string'||!value.name||value.name.length>1000||typeof value.token!=='string'||!/^[0-9a-f-]{36}$/i.test(value.token)||!Number.isSafeInteger(value.size)||value.size<1||value.size>256*1024*1024||!Number.isFinite(value.modified)||value.modified<0)throw Error('Invalid linked Smart Object source.');
  return{path:value.path,name:value.name,token:value.token,size:value.size,modified:value.modified};
}
export function linkedPsdFile(link,id){
  const value=smartLinkRecord(link),fullPath='file://'+value.path.split('/').map(encodeURIComponent).join('/');
  return{id,name:value.name,time:new Date(value.modified).toISOString(),linkedFile:{fileSize:value.size,name:value.name,fullPath,originalPath:value.path,relativePath:value.name}};
}
