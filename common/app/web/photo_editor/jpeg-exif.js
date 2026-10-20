function positive(value){const number=Array.isArray(value)?Number(value[0]):Number(value);return Number.isFinite(number)&&number>0?number:0;}
export function captureRecord(value){
  if(!value||typeof value!=='object')return null;
  const focalLength=positive(value.focalLength),focal35=positive(value.focal35),cropFactor=Number(value.cropFactor);
  if(!focalLength||!focal35||!Number.isFinite(cropFactor)||cropFactor<.1||cropFactor>10||focalLength>10000||focal35>10000)return null;
  return {focalLength,focal35,cropFactor};
}
function fromIfd(page){
  const exif=page?.exifIFD||page,focalLength=positive(exif?.t37386),focal35=positive(exif?.t41989)||focalLength;
  if(!focalLength&&!focal35)return null;
  const base=focalLength||focal35,equivalent=focal35||focalLength,cropFactor=Math.max(.1,Math.min(10,equivalent/base));
  return captureRecord({focalLength:base,focal35:equivalent,cropFactor});
}
export function readTiffCapture(page){return fromIfd(page);}
export function readJpegCapture(bytes){
  if(!window.UTIF||!(bytes instanceof Uint8Array)||bytes.length<12||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=2;
  while(offset+4<bytes.length&&bytes[offset]===0xff){
    const marker=bytes[offset+1];if(marker===0xda||marker===0xd9)break;
    const size=view.getUint16(offset+2);if(size<2||offset+2+size>bytes.length)break;
    if(marker===0xe1&&String.fromCharCode(...bytes.subarray(offset+4,offset+10))==='Exif\0\0'){
      const tiff=bytes.subarray(offset+10,offset+2+size),copy=tiff.buffer.slice(tiff.byteOffset,tiff.byteOffset+tiff.byteLength);
      const page=window.UTIF.decode(copy)[0];return fromIfd(page);
    }
    offset+=2+size;
  }
  return null;
}
