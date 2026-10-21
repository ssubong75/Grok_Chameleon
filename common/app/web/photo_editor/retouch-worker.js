import {seamlessClone} from './poisson.js';
import {proximityHeal} from './proximity-heal.js';
self.onmessage=event=>{try{const {width,height,source,destination,mask,spot,spotMode,brushWidth,channels=4}=event.data,src=new Uint8ClampedArray(source),dst=new Uint8ClampedArray(destination),hole=new Uint8Array(mask),result=spot?proximityHeal(width,height,src,hole,brushWidth,spotMode,channels):seamlessClone(width,height,src,dst,hole,channels);self.postMessage({buffer:result.buffer},[result.buffer]);}catch(error){self.postMessage({error:error.message||String(error)});}};
