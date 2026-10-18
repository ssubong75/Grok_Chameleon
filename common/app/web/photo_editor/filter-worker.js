import {adjustPixels} from './filters.js';
self.onmessage=event=>{
  const {width,height,buffer,name,amount}=event.data;
  try{let image=new ImageData(new Uint8ClampedArray(buffer),width,height);
    if(name==='Blur'){const source=new OffscreenCanvas(width,height),output=new OffscreenCanvas(width,height);source.getContext('2d').putImageData(image,0,0);const ctx=output.getContext('2d');ctx.filter=`blur(${Math.max(0,Number(amount)||0)}px)`;ctx.drawImage(source,0,0);image=ctx.getImageData(0,0,width,height);}
    else adjustPixels(image,name,amount);
    self.postMessage({width,height,buffer:image.data.buffer},[image.data.buffer]);
  }catch(error){self.postMessage({error:error.message||String(error)});}
};
