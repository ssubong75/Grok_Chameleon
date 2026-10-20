const limit=10000;
let currentCommand=null;
export function setHistoryCommand(id,params){const plain={};if(params&&typeof params==='object')for(const [key,value] of Object.entries(params))if(value==null||['string','number','boolean'].includes(typeof value))plain[key]=value;currentCommand={id:String(id||''),params:plain};}
export function clearHistoryCommand(){currentCommand=null;}
export function currentHistoryCommand(){return currentCommand?.id?{id:currentCommand.id,params:currentCommand.params}:null;}
export function historyDetail(detail,command){return detail==='detailed'&&command?.id?`  ${command.id} ${JSON.stringify(command.params||{})}`:'';}
export function historyLogRecord(value){if(value==null)return [];if(!Array.isArray(value)||value.length>limit||value.some(line=>typeof line!=='string'||line.length>4096))throw Error('Invalid history log.');return [...value];}
export function installHistoryLog(document,{preferences,append,onError,clock=()=>new Date()}){
 let last=null;const record=(label,session=false,command=null)=>{const prefs=preferences();if(!prefs.enabled||prefs.detail==='sessionsOnly'&&!session)return;const time=clock().toISOString(),name=String(document.name||'Untitled').replace(/[\r\n\t]/g,' ').slice(0,200),action=String(label).replace(/[\r\n\t]/g,' ').slice(0,200),detail=historyDetail(prefs.detail,command);const line=time+'\t'+name+'\t'+action+detail;
  if(['metadata','both'].includes(prefs.destination)){document.historyLog??=[];document.historyLog.push(line);if(document.historyLog.length>limit)document.historyLog.splice(0,document.historyLog.length-limit);}
  if(['textFile','both'].includes(prefs.destination)){if(!prefs.filePath){onError(Error('Choose a history log file path.'));return;}void append(line+'\n').catch(onError);}
 };const changed=()=>{const entry=document.undoStack.at(-1);if(!entry||entry===last)return;last=entry;record(entry.label,false,entry.command||null);};document.addEventListener('change',changed);record('Open',true);return{record,dispose(){record('Close',true);document.removeEventListener('change',changed);}};
}
