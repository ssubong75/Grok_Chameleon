import {deleteMeasurements,logColumns,logCsv,MEASUREMENT_COLUMNS} from './measurements.js';
export function measurementLogPanelOpen(){const panel=document.getElementById('measurement-log-panel');return Boolean(panel&&!panel.hidden);}
export function refreshMeasurementLog(){const panel=document.getElementById('measurement-log-panel');if(panel&&!panel.hidden&&panel._paint)panel._paint();}
export function openMeasurementLogPanel({getAnalysis,getSelected,setSelected,onRecord}){
  const existing=document.getElementById('measurement-log-panel');
  if(existing&&!existing.hidden){existing.hidden=true;return;}
  let panel=existing;
  if(!panel){panel=document.createElement('section');panel.id='measurement-log-panel';panel.style.cssText='position:fixed;right:16px;bottom:24px;z-index:40;width:620px;display:flex;flex-direction:column;gap:6px;padding:8px;background:#2b2b2b;color:#eee;border:1px solid #555;font:12px sans-serif';document.body.append(panel);}
  panel.hidden=false;
  const button=(text,on)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=on;return node;};
  const paint=()=>{
    const analysis=getAnalysis(),rows=analysis.log||[],selected=new Set(getSelected());
    const title=document.createElement('div');title.style.cssText='display:flex;justify-content:space-between';const name=document.createElement('strong');name.textContent='Measurement Log';title.append(name,button('×',()=>{panel.hidden=true;}));
    const bar=document.createElement('div');bar.style.cssText='display:flex;gap:6px;align-items:center';
    bar.append(button('Record Measurements',()=>{Promise.resolve(onRecord()).then(()=>paint());}),button('Select All',()=>{setSelected(rows.map(row=>row.id));paint();}),button('Deselect All',()=>{setSelected([]);paint();}));
    const side=document.createElement('span');side.style.marginLeft='auto';
    side.append(button('Delete',()=>{if(!selected.size)return;deleteMeasurements(analysis,{rows:[...selected]});setSelected([]);paint();}),button('Export',()=>{const ids=[...selected],chosen=ids.length?rows.filter(row=>ids.includes(row.id)):rows,csv=logCsv(chosen),file=document.createElement('a');file.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));file.download='Measurement Log.csv';file.click();}));
    bar.append(side);
    const columns=logColumns(rows).filter(key=>key!=='histogram'),table=document.createElement('div');table.style.cssText='overflow:auto;max-height:220px';
    const grid=document.createElement('table');grid.style.cssText='border-collapse:collapse;white-space:nowrap';
    const head=document.createElement('tr');
    for(const key of columns){const cell=document.createElement('th');cell.textContent=MEASUREMENT_COLUMNS.find(column=>column[0]===key)?.[1]||key;cell.style.cssText='text-align:left;padding:2px 8px;color:#aaa';head.append(cell);}
    grid.append(head);
    for(const row of rows){const line=document.createElement('tr'),on=selected.has(row.id);columns.forEach((key,index)=>{const cell=document.createElement('td');const value=row.values?.[key];cell.textContent=value==null?'':Array.isArray(value)?value.join(' '):String(value);cell.style.cssText='padding:2px 8px;color:'+(on?'#9cf':'#eee');if(index===0){cell.style.cursor='pointer';cell.onclick=()=>{const next=getSelected().filter(id=>id!==row.id);if(!on)next.push(row.id);setSelected(next);paint();};}line.append(cell);});grid.append(line);}
    table.append(grid);
    panel.replaceChildren(title,bar,table);
  };
  panel._paint=paint;paint();
}
