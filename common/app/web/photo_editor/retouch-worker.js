import {seamlessClone} from './poisson.js';
import {proximityHeal} from './proximity-heal.js';
self.onmessage=event=>{try{const {width,height,source,destination,mask,spot,spotMode,brushWidth}=event.data,result=spot?proximityHeal(width,height,new Uint8ClampedArray(source),new Uint8Array(mask),brushWidth,spotMode):seamlessClone(width,height,new Uint8ClampedArray(source),new Uint8ClampedArray(destination),new Uint8Array(mask));self.postMessage({buffer:result.buffer},[result.buffer]);}catch(error){self.postMessage({error:error.message||String(error)});}};
