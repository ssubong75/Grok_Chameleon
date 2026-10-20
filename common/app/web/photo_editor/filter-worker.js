import {adjustPixels} from './filters.js';
self.onmessage=event=>{
  const {width,height,buffer,name,amount}=event.data;
  try{let image=new ImageData(new Uint8ClampedArray(buffer),width,height);
    const result=adjustPixels(image,name,amount)||image;
    self.postMessage({width:result.width,height:result.height,x:result.x||0,y:result.y||0,buffer:result.data.buffer},[result.data.buffer]);
  }catch(error){self.postMessage({error:error.message||String(error)});}
};
