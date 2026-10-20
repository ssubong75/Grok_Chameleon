import {replacePsdResources} from './psd-paths.js';
// Photoshop resource 1036: JPEG thumbnail with a 28-byte, big-endian header.
export function writePsdPreview(bytes,canvas){
  const scale=Math.min(1,160/canvas.width,160/canvas.height),width=Math.max(1,Math.round(canvas.width*scale)),height=Math.max(1,Math.round(canvas.height*scale));
  const thumbnail=document.createElement('canvas');thumbnail.width=width;thumbnail.height=height;const context=thumbnail.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(canvas,0,0,width,height);
  const url=thumbnail.toDataURL('image/jpeg',.8);if(!url.startsWith('data:image/jpeg;base64,'))throw Error('JPEG thumbnail encoding is unavailable.');const jpeg=Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),character=>character.charCodeAt(0)),rowBytes=Math.ceil(width*24/32)*4,data=new Uint8Array(28+jpeg.length),view=new DataView(data.buffer);
  [1,width,height,rowBytes,rowBytes*height,jpeg.length].forEach((value,index)=>view.setUint32(index*4,value));view.setUint16(24,24);view.setUint16(26,1);data.set(jpeg,28);return replacePsdResources(bytes,[{id:1036,data}]);
}
