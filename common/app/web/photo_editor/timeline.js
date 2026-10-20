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
