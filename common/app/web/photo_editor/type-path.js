// PhotoCraft type.createWorkPath stores one work path. These contours are traced from coverage, not font outlines.
import {traceMask} from './shape-trace.js';
export function typeWorkPath(alpha,width,height,x=0,y=0){
  const traced=traceMask(alpha,width,height,x,y,0,1);
  return {name:'Work Path',psdWorkPath:true,nodes:traced.nodes,closed:traced.closed!==false,op:traced.op||'combine',subpaths:traced.subpaths||[],fillRule:traced.fillRule||'nonzero'};
}
