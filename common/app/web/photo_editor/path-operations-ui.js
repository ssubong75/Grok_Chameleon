import {PathBooleanTask} from './path-boolean-task.js';

export async function editPathOperation(d,getDocument,showDialog){
  const paths=[...d.paths].sort((a,b)=>Number(b.id===d.activePathId)-Number(a.id===d.activePathId));
  if(paths.length<2)throw Error('Create at least two paths first.');
  const labels={combine:'Compound Path',union:'Union',difference:'Difference',intersection:'Intersection',xor:'Exclude Overlap'};
  const fields=[{key:'operation',label:'Operation',options:[['combine','Make Compound Path'],['union','Unite Shapes'],['difference','Subtract from First Path'],['intersection','Intersect Shapes'],['xor','Exclude Overlap']],value:'union'},
    {text:'For subtraction, the first selected path below is the base shape.'},
    ...paths.map((path,index)=>({key:'path'+index,label:path.name||'Path '+(index+1),type:'checkbox',value:index<2})),
    {key:'precision',label:'Curve Precision (px)',type:'number',min:.05,max:10,step:'any',value:.25},
    {text:'Unite, Subtract, Intersect, and Exclude produce straight path segments at the chosen curve precision. Make Compound Path retains curve handles.'},
    {key:'keep',label:'Keep Original Paths',type:'checkbox',value:true}];
  const values=await showDialog('Combine Paths',fields);if(!values||getDocument()!==d)return;
  const selected=paths.filter((path,index)=>values['path'+index]);if(selected.length<2||selected.length>64)throw Error('Select between 2 and 64 paths.');
  const snapshots=selected.map(path=>structuredClone(path)),fingerprints=snapshots.map(path=>JSON.stringify(path)),task=new PathBooleanTask();let completed=false;
  const pending=showDialog('Combining Paths',[{text:'Calculating path contours… Cancel stops the operation.'}],false);
  pending.then(()=>{if(!completed)task.cancel();});
  try{
    const result=await task.run(snapshots,values.operation,Number(values.precision));completed=true;
    document.querySelector('#dialog').close('done');await pending;if(getDocument()!==d)return;
    if(selected.some((path,index)=>!d.paths.includes(path)||JSON.stringify(path)!==fingerprints[index]))throw Error('The source paths changed while the operation was running.');
    if(!result)return{empty:true};
    const name=labels[values.operation]||'Path';d.checkpoint(name);
    if(!values.keep){const ids=new Set(selected.map(path=>path.id));d.paths=d.paths.filter(path=>!ids.has(path.id));}
    const path={...result,id:crypto.randomUUID(),name:name+' '+(d.paths.length+1)};d.paths.push(path);d.activePathId=path.id;d.changed();return{path};
  }catch(error){if(error.name!=='AbortError')throw error;}
  finally{completed=true;task.cancel();if(document.querySelector('#dialog').open)document.querySelector('#dialog').close('done');}
}
