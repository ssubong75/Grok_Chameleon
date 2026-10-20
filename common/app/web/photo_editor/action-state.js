// PhotoCraft actions_cmds.rs, 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
// Restricted local command subset; no file commands or native ATN support yet.
export const actionCommands=new Set(['select.all','select.none','select.inverse','image.cw','image.ccw','image.rotate180','image.flipH','image.flipV','view.fit','view.actual','view.in','view.out','layer.rename','layer.setProps','actions.stopMessage','actions.play']);
export const actionColors=['','red','orange','yellow','green','blue','violet','gray'];
export function actionParams(id,params={}){
  if(!actionCommands.has(id)||!params||Array.isArray(params)||typeof params!=='object')throw Error('Unsupported local action step.');
  if(id==='layer.setProps'){const keys=Object.keys(params);if(keys.length!==1||!['opacity','fill'].includes(keys[0])||typeof params[keys[0]]!=='number'||!Number.isFinite(params[keys[0]])||params[keys[0]]<0||params[keys[0]]>1)throw Error('Invalid action layer percentage.');return{[keys[0]]:params[keys[0]]};}
  if(id==='actions.play'){if(Object.keys(params).some(key=>!['action','from'].includes(key))||typeof params.action!=='string'||!params.action.trim()||params.action.length>200||params.from!==undefined&&(!Number.isInteger(params.from)||params.from<0||params.from>1000))throw Error('Invalid nested action call.');return{action:params.action,...(params.from!==undefined?{from:params.from}:{})};}
  if(id==='actions.stopMessage'){if(Object.keys(params).some(key=>!['message','allowContinue'].includes(key))||typeof params.message!=='string'||params.message.length>4000||typeof params.allowContinue!=='boolean')throw Error('Invalid action stop message.');return{message:params.message,allowContinue:params.allowContinue};}
  if(id==='layer.rename'){if(Object.keys(params).some(key=>key!=='name')||typeof params.name!=='string'||!params.name.trim()||params.name.length>1000)throw Error('Enter a valid layer name of at most 1,000 characters.');return{name:params.name};}
  if(Object.keys(params).length)throw Error('Unexpected action parameters.');return{};
}
export function actionFile(value){
  if(!value||value.version!==1||!Array.isArray(value.actions)||value.actions.length>100)throw Error('Invalid local actions file.');
  const names=new Set();return{version:1,actions:value.actions.map(a=>{
    if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>200||names.has(a.name)||!Array.isArray(a.steps)||a.steps.length>1000)throw Error('Invalid action name or step count.');names.add(a.name);
    const steps=a.steps.map(step=>{if(!Array.isArray(step)||step.length!==2)throw Error('Invalid action step.');return[step[0],actionParams(step[0],step[1])];});
    const disabled=a.disabled??[];if(!Array.isArray(disabled)||disabled.length>steps.length||disabled.some(i=>!Number.isInteger(i)||i<0||i>=steps.length))throw Error('Invalid disabled action steps.');if(a.set!==undefined&&a.set!==null&&(typeof a.set!=='string'||!a.set.trim()||a.set.length>200)||!actionColors.includes(a.color??''))throw Error('Invalid action set or color.');return{name:a.name,steps,disabled:[...new Set(disabled)].sort((a,b)=>a-b),set:a.set??null,color:a.color??''};
  })};
}
export class ActionState{
  constructor(){this.list=[];this.selected=null;this.recording=null;this.playing=false;this.cancelled=false;this.buttonMode=false;}
  serialize(){const text=JSON.stringify(actionFile({version:1,actions:this.list}));if(text.length>4*1024*1024)throw Error('Actions exceed the local size limit.');return text;}
  restore(text){if(this.playing||this.recording!==null)throw Error('Stop before loading actions.');if(typeof text!=='string'||text.length>4*1024*1024)throw Error('Actions exceed the local size limit.');const file=actionFile(JSON.parse(text));this.list=file.actions;this.selected=this.list.length?0:null;}
  current(){return this.list[this.selected]||null;}
  record(name,append=false){if(this.playing||this.recording!==null)throw Error('Stop the current action first.');if(!append){name=String(name||'').trim();if(!name||name.length>200)throw Error('Enter an action name of 1–200 characters.');if(this.list.some(a=>a.name===name))throw Error('An action with this name already exists.');if(this.list.length>=100)throw Error('The local action limit is 100.');this.list.push({name,steps:[],disabled:[],set:null,color:''});this.selected=this.list.length-1;}if(!this.current())throw Error('Select an action first.');this.recording=this.selected;}
  stop(){if(this.playing){this.cancelled=true;return;}this.recording=null;}
  capture(id,params={}){if(this.recording===null||this.playing||!actionCommands.has(id))return;const a=this.list[this.recording];if(a.steps.length>=1000){this.recording=null;throw Error('Recording stopped at the local 1,000-step limit.');}const prepared=actionParams(id,params);a.steps.push([id,prepared]);}
  remove(){if(this.playing||this.recording!==null)throw Error('Stop before deleting an action.');if(!this.current())return;this.list.splice(this.selected,1);this.selected=this.list.length?Math.min(this.selected,this.list.length-1):null;}
  options(set,color){if(this.playing||this.recording!==null)throw Error('Stop before changing action options.');const a=this.current();if(!a||set!==null&&(typeof set!=='string'||!set.trim()||set.length>200)||!actionColors.includes(color))throw Error('Invalid action set or color.');a.set=set===null?null:set.trim();a.color=color;}
  rename(name){if(this.playing||this.recording!==null)throw Error('Stop before renaming.');const a=this.current();name=String(name||'').trim();if(!a||!name||name.length>200)throw Error('Enter a valid action name.');if(this.list.some(other=>other!==a&&other.name===name))throw Error('An action with this name already exists.');const old=a.name;for(const other of this.list)for(const [id,params]of other.steps)if(id==='actions.play'&&params.action===old)params.action=name;a.name=name;}
  deleteStep(index){if(this.playing||this.recording!==null)throw Error('Stop before deleting steps.');const a=this.current();if(!a||!Number.isInteger(index)||index<0||index>=a.steps.length)throw Error('Select a valid action step.');a.steps.splice(index,1);a.disabled=a.disabled.filter(i=>i!==index).map(i=>i>index?i-1:i);}
  insert(id,params,at=this.current()?.steps.length){if(this.playing||this.recording!==null)throw Error('Stop before inserting steps.');const a=this.current(),prepared=actionParams(id,params);if(!a||a.steps.length>=1000||!Number.isInteger(at)||at<0||at>a.steps.length)throw Error('Invalid action insertion position.');if(id==='actions.play'&&prepared.action===a.name)throw Error('An action cannot play itself.');a.steps.splice(at,0,[id,prepared]);a.disabled=a.disabled.map(i=>i>=at?i+1:i);}
  moveStep(from,to){if(this.playing||this.recording!==null)throw Error('Stop before moving steps.');const a=this.current();if(!a||![from,to].every(i=>Number.isInteger(i)&&i>=0&&i<a.steps.length))throw Error('Invalid action step destination.');const step=a.steps.splice(from,1)[0];a.steps.splice(to,0,step);a.disabled=a.disabled.map(i=>i===from?to:from<i&&i<=to?i-1:to<=i&&i<from?i+1:i).sort((a,b)=>a-b);}
  toggle(index){if(this.playing||this.recording!==null)throw Error('Stop before editing steps.');const a=this.current();if(!a||!Number.isInteger(index)||index<0||index>=a.steps.length)throw Error('Select a valid action step.');a.disabled=a.disabled.includes(index)?a.disabled.filter(i=>i!==index):[...a.disabled,index];}
  async play(execute,notify=()=>{},from=0){
    if(this.playing||this.recording!==null)throw Error('Stop recording before playback.');
    const current=this.current();if(!current?.steps.length)throw Error('Select an action with recorded steps.');
    if(!Number.isInteger(from)||from<0||from>current.steps.length)throw Error('Invalid playback start step.');
    const plans=structuredClone(this.list),root=plans.find(a=>a.name===current.name),stack=[];let ran=0,executed=0;
    const run=async(action,start)=>{
      if(!action)throw Error('Nested action was not found.');
      if(stack.includes(action.name))throw Error('Recursive action call: '+action.name);
      if(stack.length>=16)throw Error('Action nesting exceeds 16 levels.');
      if(!Number.isInteger(start)||start<0||start>action.steps.length)throw Error('Invalid nested playback start step.');
      stack.push(action.name);
      try{for(let i=start;i<action.steps.length;i++){
        if(this.cancelled)break;if(action.disabled.includes(i))continue;
        if(++executed>10000)throw Error('Playback exceeds the local 10,000-step limit.');
        const [id,raw]=action.steps[i],params=actionParams(id,raw);
        try{if(id==='actions.play')await run(plans.find(a=>a.name===params.action),params.from??0);else await execute(id,params);}catch(error){throw Error(action.name+' / step '+(i+1)+': '+error.message);}
        if(stack.length===1)ran++;await new Promise(resolve=>setTimeout(resolve,0));
      }}finally{stack.pop();}
    };
    this.playing=true;this.cancelled=false;
    try{notify();await run(root,from);return{ran,cancelled:this.cancelled};}finally{this.playing=false;this.cancelled=false;notify();}
  }
}
