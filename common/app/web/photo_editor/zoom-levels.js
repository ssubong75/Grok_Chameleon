// Port of ui-egui/src/zoom_levels.rs step_in_range. See vendor/photocraft-ports.NOTICE.txt.
export const zoomLadder=Object.freeze([.001,.002,.003,.004,.005,.007,.01,.015,.02,.03,.04,.05,.0625,1/12,.125,1/6,.25,1/3,.5,2/3,1,2,3,4,5,6,7,8,12,16,32,64,128]);
export function stepZoom(zoom,direction,low=.01,high=32){
  const z=Number.isFinite(zoom)?Math.max(low,Math.min(high,zoom)):1;
  const next=direction>0?zoomLadder.find(value=>value>z*1.001)??high:[...zoomLadder].reverse().find(value=>value<z*.999)??z;
  return Number.isFinite(next)?Math.max(low,Math.min(high,next)):z;
}
