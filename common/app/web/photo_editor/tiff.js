import {surface} from './engine.js';
export function tiffPages(buffer){if(!window.UTIF)throw Error('TIFF codec is unavailable.');return window.UTIF.decode(buffer).filter(page=>page.t256?.[0]>0&&page.t257?.[0]>0);}
export function readTIFF(buffer,page,pages){
  const width=Number(page.t256?.[0]),height=Number(page.t257?.[0]);if(width*height>64000000||width>32767||height>32767)throw Error('TIFF exceeds the current image size limit.');
  window.UTIF.decodeImage(buffer,page,pages);const rgba=window.UTIF.toRGBA8(page),canvas=surface(width,height);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
  const orientation=Number(page.t274?.[0]||1);if(orientation===1)return canvas;
  const rotated=orientation>=5,output=surface(rotated?height:width,rotated?width:height),ctx=output.getContext('2d');
  const matrix=({2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],5:[0,1,1,0,0,0],6:[0,1,-1,0,height,0],7:[0,-1,-1,0,height,width],8:[0,-1,1,0,0,width]})[orientation];if(matrix)ctx.setTransform(...matrix);ctx.drawImage(canvas,0,0);return output;
}
export function writeTIFF(canvas,resolution=72){if(!window.UTIF)throw Error('TIFF codec is unavailable.');const {data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return window.UTIF.encodeImage(data.buffer,canvas.width,canvas.height,{t338:[2],t282:[resolution],t283:[resolution],t296:[2],t305:['Photo Editor']});}
