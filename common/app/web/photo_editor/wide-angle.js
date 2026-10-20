import {solveWideMesh} from './wide-angle-mesh.js';
import {warpTriangles} from './warp-triangles.js';
export function adaptiveWideAngle(image,settings={}){
  const width=Number(settings.documentWidth)||image.width,height=Number(settings.documentHeight)||image.height,params={...settings,scale:Math.max(50,Math.min(150,Number(settings.scale??100))),cropFactor:Math.max(.1,Math.min(10,Number(settings.cropFactor??1)))};
  const mesh=solveWideMesh(params,width,height);return warpTriangles(image,mesh.vertices,mesh.triangles,{...settings,expand:true});
}
