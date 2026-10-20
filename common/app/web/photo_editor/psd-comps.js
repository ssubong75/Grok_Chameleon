// PhotoCraft io/comps_map.rs, 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
// Adaptation to ag-psd's decoded resource1065 and layer cmls records.
import {compLayerPosition,validateLayerComps} from './layer-comps.js';
const int=v=>Number.isInteger(v)&&v>=-2147483648&&v<=2147483647;
export function importPsdComps(resource,pairs,positionOf=compLayerPosition){
  if(!resource)return{comps:[],last:null,applied:null};
  if(!Array.isArray(resource.list)||resource.list.length>100)throw Error('PSD layer comp count exceeds the local limit.');
  const byId=new Map(),comps=resource.list.map(entry=>{if(!Number.isInteger(entry.id)||!(entry.id>>>0)||byId.has(entry.id>>>0)||typeof entry.name!=='string')throw Error('Invalid PSD comp identifier or name.');const flags=Number(entry.capturedInfo)||0,comp={id:'psd-comp-'+(entry.id>>>0),name:entry.name||'Layer Comp',comment:entry.comment||'',visibility:Boolean(flags&1),position:Boolean(flags&2),appearance:Boolean(flags&4),states:[]};byId.set(entry.id>>>0,comp);return comp;});
  const last={id:'last-state',name:'Last Document State',visibility:true,position:true,appearance:false,states:[]};
  for(const {layer,item}of pairs){const settings=item.comps?.settings;if(!settings)continue;if(!Array.isArray(settings)||settings.length>101)throw Error('Invalid PSD comp settings.');const here=positionOf(layer);
    for(const setting of settings){if(!Array.isArray(setting.compList)||setting.compList.length>101)throw Error('Invalid PSD comp references.');let position=null;if(here&&setting.offset&&int(here.x+setting.offset.x)&&int(here.y+setting.offset.y))position={x:here.x+setting.offset.x,y:here.y+setting.offset.y};const visible=typeof setting.enabled==='boolean'?setting.enabled:null;if(visible==null&&position==null)continue;
      for(const raw of setting.compList){if(!Number.isInteger(raw))throw Error('Invalid PSD comp reference.');const comp=(raw>>>0)===0?last:byId.get(raw>>>0);if(!comp)continue;const state={id:layer.id,visible,position,appearance:null},at=comp.states.findIndex(s=>s.id===layer.id);if(at<0)comp.states.push(state);else comp.states[at]=state;}
    }
  }
  const clean=validateLayerComps(comps),cleanLast=last.states.length?validateLayerComps([last])[0]:null;
  return{comps:clean,last:cleanLast,applied:byId.get(resource.lastApplied>>>0)?.id||null};
}
export function exportPsdComps(document,positionOf=compLayerPosition){
  const comps=validateLayerComps(document.layerComps||[]);if(!comps.length)return null;
  const ids=new Map(comps.map((c,i)=>[c.id,i+1])),positions=new Map(document.layers.map(l=>[l.id,positionOf(l)])),layerIds=new Map(document.layers.map((l,i)=>[l.id,i+1]));
  const resource={list:comps.map(c=>({id:ids.get(c.id),name:c.name,comment:c.comment||'',capturedInfo:(c.visibility?1:0)|(c.position?2:0)|(c.appearance?4:0)}))};if(ids.has(document.appliedComp))resource.lastApplied=ids.get(document.appliedComp);
  return{resource,forLayer(layer,positionSupported=true){const settings=[],here=positions.get(layer.id);for(const comp of [...comps,...(document.lastCompState?[{...document.lastCompState,id:null}]:[])]){const state=comp.states.find(s=>s.id===layer.id);if(!state)continue;const setting={compList:[comp.id===null?0:ids.get(comp.id)]};if(state.visible!=null)setting.enabled=state.visible;if(positionSupported&&!layer.artboard&&here&&state.position){const x=state.position.x-here.x,y=state.position.y-here.y;if(int(x)&&int(y))setting.offset={x,y};}settings.push(setting);}return{id:layerIds.get(layer.id),comps:{settings}};}};
}
