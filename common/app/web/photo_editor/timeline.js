const MAX_DURATION=1000000, MAX_FPS=1000;
export function timelineCreate(duration=30,fps=30){
  if(!Number.isInteger(duration)||duration<1||duration>MAX_DURATION)throw Error('Duration must be a whole number of frames from 1 to '+MAX_DURATION+'.');
  if(!Number.isFinite(fps)||fps<=0||fps>MAX_FPS)throw Error('Frame rate must be above 0 and at most '+MAX_FPS+'.');
  return {fps,duration,current:0,workStart:0,workEnd:duration};
}
export function timelineStep(timeline,delta){
  const n=Math.min(Number.MAX_SAFE_INTEGER,Math.abs(delta)|0);
  const moved=delta<0?Math.max(0,timeline.current-n):timeline.current+n;
  return Math.min(moved,Math.max(0,timeline.duration-1));
}
export function timelineFrame(timeline,frame){
  if(!Number.isInteger(frame)||frame<0)throw Error('Need a frame.');
  return Math.min(frame,Math.max(0,timeline.duration-1));
}
export function timelineTime(timeline){return timeline.current/Math.max(1e-3,timeline.fps);}
export function nextLayerName(layers,base){const names=new Set((layers||[]).map(layer=>layer.name));for(let n=1;n<=names.size+1;n++){const name=base+' '+n;if(!names.has(name))return name;}return base;}
export function blankVideoPlan(doc){const timeline=doc?.timeline||timelineCreate(1,30),frames=Math.max(1,timeline.duration|0);return {timeline,name:nextLayerName(doc?.layers,'Video Layer'),frames,fps:timeline.fps,source:'blank',showAltered:true};}
export function blankInsertIndex(count,current){return Math.min(Math.max(0,current|0)+1,count|0);}
export function duplicateFrameIndex(count,current){const n=count|0,cur=current|0;return cur>=0&&cur<n?cur+1:null;}
export function deleteFrameIndex(count,current){const n=count|0,cur=current|0;return n>1&&cur>=0&&cur<n?cur:null;}
export function restoredAllFrames(frames,original){if(!Array.isArray(frames))return frames;return frames.map((frame,index)=>Array.isArray(original)&&index<original.length&&original[index]!=null?original[index]:null);}
export function restoredFrames(frames,original,current){if(!Array.isArray(frames))return frames;const cur=current|0;if(cur<0||cur>=frames.length)return frames.slice();const next=frames.slice();next[cur]=Array.isArray(original)&&cur<original.length&&original[cur]!=null?original[cur]:null;return next;}
export function videoFrameIndex(count,current){const n=count|0;if(n<1)return 0;return Math.min(Math.max(0,current|0),n-1);}
export function videoVisibleStack(video){if(!video)throw Error('the active layer is not a video layer');const showAltered=video.showAltered===false;return {showAltered,stack:showAltered||!Array.isArray(video.originalFrames)?'frames':'originalFrames'};}
export function footageFps(value){if(value==null)return null;const fps=Number(value);if(!Number.isFinite(fps)||fps<=0||fps>1000)throw Error('`fps` must be a number above 0 and at most 1000, got '+value);return fps;}
export function growTimeline(timeline,frames){if(!timeline)return null;const old=timeline.duration|0,duration=Math.max(old,Math.max(1,frames|0)),workEnd=(timeline.workEnd??old)>=old?duration:timeline.workEnd;return {...timeline,duration,workEnd,current:Math.min(timeline.current|0,Math.max(0,duration-1))};}
export function videoFilePlan(doc,names,fps){if(!names?.length)throw Error('no images in the selection');const stem=String(names[0]).replace(/\.[^.]+$/,'').split(/[\\/]/).pop()||'Video',n=names.length,rate=Number.isFinite(fps)&&fps>0?fps:30;let timeline;if(!doc?.timeline)timeline=timelineCreate(n,rate);else{const old=doc.timeline.duration,duration=Math.max(old,n),workEnd=doc.timeline.workEnd>=old?duration:doc.timeline.workEnd;timeline={...doc.timeline,duration,workEnd,current:Math.min(doc.timeline.current||0,duration-1)};}return {timeline,name:nextLayerName(doc?.layers,stem),frames:n,fps:rate,source:'file'};}
