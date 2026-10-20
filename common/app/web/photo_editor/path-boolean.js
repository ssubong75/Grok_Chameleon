import './vendor/polygon-clipping.js';
import {pathContours} from './paths.js';
import {measurePath} from './path-metrics.js';

const clipping=globalThis.polygonClipping;
export function combinePaths(paths,operation='union',tolerance=.25){
  if(!Array.isArray(paths)||paths.length<2||paths.length>64)throw Error('Select between 2 and 64 paths.');
  if(!Number.isFinite(tolerance)||tolerance<.05||tolerance>10)throw Error('Curve precision must be between 0.05 and 10 pixels.');
  const contours=[];let nodes=0;
  if(operation==='combine'){
    for(const path of paths)for(const contour of pathContours(path)){nodes+=contour.nodes.length;if(nodes>10000)throw Error('The combined path exceeds 10,000 anchor points.');contours.push({closed:Boolean(contour.closed),nodes:structuredClone(contour.nodes)});}
  }else{
    if(!['union','difference','intersection','xor'].includes(operation))throw Error('Unknown path operation.');
    let sampled=0;
    const geometries=paths.map(path=>{
      let geometry=[];
      for(const contour of pathContours(path)){
        if(!contour.closed||contour.nodes.length<2)throw Error('Close each path contour before applying a Boolean operation.');
        const points=measurePath(contour,tolerance).points;sampled+=points.length;if(sampled>100000)throw Error('These curves are too complex. Increase curve precision or simplify the paths.');
        if(points.length<4)continue;const ring=points.map(point=>[point.x,point.y]),single=[[ring]];
        geometry=geometry.length?(path.fillRule==='evenodd'?clipping.xor(geometry,single):clipping.union(geometry,single)):single;
      }
      return geometry;
    });
    if(operation==='intersection'&&geometries.some(geometry=>!geometry.length))return null;
    if(operation==='difference'&&!geometries[0].length)return null;
    const inputs=operation==='difference'?[geometries[0],...geometries.slice(1).filter(g=>g.length)]:geometries.filter(g=>g.length);
    if(!inputs.length)return null;
    const output=clipping[operation](...inputs);
    for(const polygon of output)for(const ring of polygon){const values=ring.slice(0,-1).map(([x,y])=>({x,y}));nodes+=values.length;if(nodes>10000)throw Error('The resulting path exceeds 10,000 anchor points. Increase curve precision.');if(values.length>=3)contours.push({closed:true,nodes:values});}
  }
  if(!contours.length)return null;const [first,...subpaths]=contours;return{...first,subpaths,fillRule:'evenodd'};
}
