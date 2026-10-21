const MAX_PRESETS=1000,MAX_NAME=255;
const BRUSHY=new Set(['brush','pencil','eraser','clonestamp','healing','spothealing','historybrush','blur','sharpen','smudge','dodge','burn','sponge','mixerbrush','colorreplacement']);
export function builtinToolPresets(){const brush=(size,hardness)=>({brush:{size,hardness}});return [
  {name:'Soft Round 100 px',tool:'brush',options:brush(100,0)},
  {name:'Hard Round 12 px',tool:'brush',options:brush(12,1)},
  {name:'Soft Eraser 60 px',tool:'eraser',options:brush(60,0)},
  {name:'Radial Gradient',tool:'gradient',options:{toolOptions:{gradient_style:'radial'}}},
  {name:'Clone Soft 40 px',tool:'cloneStamp',options:brush(40,.2)}
];}
export function toolPresetKey(tool){const key=String(tool||'').toLowerCase().replaceAll(' ','').replaceAll('_','').replaceAll('-','').replace(/tool$/,'');return key==='clone'?'clonestamp':key;}
function checkedName(name,command){const text=String(name??'').trim();if(!text)throw Error(command+': the preset name is empty');if([...text].length>MAX_NAME)throw Error(command+': preset names are at most '+MAX_NAME+' characters');return text;}
function uniqueName(presets,base){const taken=name=>presets.some(item=>item.name===name);if(!taken(base))return base;for(let i=2;i<100000;i++)if(!taken(base+' '+i))return base+' '+i;return base;}
export function listToolPresets(presets,tool){const filter=tool?toolPresetKey(tool):null;return (presets||[]).filter(item=>!filter||toolPresetKey(item.tool)===filter).map(item=>({name:item.name,tool:item.tool}));}
export function newToolPreset(presets,{name=null,tool,options={},includeColor=false,foreground=null,currentBrush=null}={}){
  if(!tool)throw Error('tool.presets.new: missing `tool`');
  const stored=options&&typeof options==='object'&&!Array.isArray(options)?{...options}:null;
  if(!stored)throw Error('tool.presets.new: `options` must be an object');
  if(!stored.brush&&BRUSHY.has(toolPresetKey(tool))&&currentBrush)stored.brush=currentBrush;
  if(includeColor&&foreground)stored.foreground=foreground;
  if(presets.length>=MAX_PRESETS)throw Error('tool.presets.new: at most '+MAX_PRESETS+' tool presets can be saved; delete some first');
  const base=name==null||String(name).trim()===''?tool:checkedName(name,'tool.presets.new');
  const label=uniqueName(presets,base);
  presets.push({name:label,tool,options:stored});
  return {name:label,tool};
}
export function selectToolPreset(presets,name){const found=(presets||[]).find(item=>item.name===name);if(!found)throw Error('tool.presets.select: no tool preset "'+name+'" (see tool.presets.list)');return {name:found.name,tool:found.tool,options:found.options};}
export function editToolPreset(presets,params={}){
  const action=params.action;if(action!=='rename'&&action!=='delete')throw Error('tool.presets.edit: tool presets support rename and delete');
  if(action==='rename')checkedName(params.name,'tool.presets.edit');
  const names=[...new Set(Array.isArray(params.preset)?params.preset:[params.preset])];
  if(names.some(name=>!presets.some(item=>item.name===name)))throw Error('tool.presets.edit: no preset "'+names.find(name=>!presets.some(item=>item.name===name))+'"');
  if(action==='delete'){for(const name of names){const index=presets.findIndex(item=>item.name===name);presets.splice(index,1);}return {deleted:names.length};}
  if(params.preset!==params.name&&presets.some(item=>item.name===params.name))throw Error('tool.presets.edit: a preset named "'+params.name+'" already exists');
  presets.find(item=>item.name===params.preset).name=params.name;
  return {name:params.name};
}
