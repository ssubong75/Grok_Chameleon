// PhotoCraft character styles: named partial attributes. None is implicit and is not a stored style.
const FIELDS={size:'size',size_pt:'size',font_family:'font',font:'font',color:'color',italic:'italic',bold:'bold',underline:'underline',fontWeight:'fontWeight'};
export function characterStyles(doc){if(!Array.isArray(doc.characterStyles))doc.characterStyles=[];return doc.characterStyles;}
export function uniqueStyleName(styles,base='Character Style'){const taken=new Set(['None',...styles.map(style=>style.name)]);for(let i=1;i<100000;i++){const name=base+' '+i;if(!taken.has(name))return name;}return '';}
export function nextStyleId(styles){const max=styles.reduce((id,style)=>Math.max(id,style.id|0),0);if(max>=0xffffffff)throw Error('no free character style id');return max+1;}
function copyAttrs(attrs){const out={};for(const [key,value] of Object.entries(attrs||{})){if(!FIELDS[key])throw Error('unknown attribute '+key);out[key]=value;}return out;}
export function newCharacterStyle(styles,options={}){const name=typeof options.name==='string'&&options.name.trim()?options.name.trim():uniqueStyleName(styles);if(!name||name==='None')throw Error('name the style');const style={id:nextStyleId(styles),name,attrs:copyAttrs(options.attrs)};styles.push(style);return style;}
export function listCharacterStyles(styles){return [{id:0,name:'None',attrs:{}},...styles.map(style=>({id:style.id,name:style.name,attrs:{...style.attrs}}))];}
export function requireCharacterStyle(styles,id){if((id|0)===0)throw Error('"None" is not a style');const style=styles.find(item=>item.id===(id|0));if(!style)throw Error('no style with id '+id);return style;}
export function renameCharacterStyle(styles,id,name){const style=requireCharacterStyle(styles,id),next=String(name||'').trim();if(!next||next==='None')throw Error('name the style');style.name=next;return style;}
export function duplicateCharacterStyle(styles,id){const style=requireCharacterStyle(styles,id),copy={id:nextStyleId(styles),name:style.name+' copy',attrs:{...style.attrs}};styles.splice(styles.indexOf(style)+1,0,copy);return copy;}
export function deleteCharacterStyle(styles,id){const style=requireCharacterStyle(styles,id);styles.splice(styles.indexOf(style),1);}
export function applyCharacterAttrs(text,style){const next={...text,characterStyleId:style.id};for(const [key,value] of Object.entries(style.attrs||{})){const field=FIELDS[key];if(!field)throw Error('unknown attribute '+key);next[field]=key==='size'||key==='size_pt'?Number(value):value;}return next;}
