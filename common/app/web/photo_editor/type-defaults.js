// PhotoCraft type.saveDefaultTypeStyles / loadDefaultTypeStyles. The saved style lives for this session.
let saved=null;
export function saveTypeDefaults(text){
  if(!text)throw Error('the active layer is not a type layer');
  saved={font:text.font||'Inter',size:Number(text.size)||48,color:text.color||'#000000',align:text.align||'left',bold:Boolean(text.bold),italic:Boolean(text.italic),underline:Boolean(text.underline)};
  return {...saved};
}
export function savedTypeDefaults(){return saved?{...saved}:null;}
export function loadTypeDefaults(text){
  if(!saved)throw Error('no default type styles have been saved');
  if(!text)throw Error('the active layer is not a type layer');
  return {...text,...saved};
}
