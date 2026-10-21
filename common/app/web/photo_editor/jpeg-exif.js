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
export function jpegExifBytes(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=2;
  while(offset+4<bytes.length&&bytes[offset]===0xff){
    const marker=bytes[offset+1];if(marker===0xda||marker===0xd9)break;
    const size=view.getUint16(offset+2);if(size<2||offset+2+size>bytes.length)break;
    if(marker===0xe1&&String.fromCharCode(...bytes.subarray(offset+4,offset+10))==='Exif\0\0')return bytes.slice(offset+10,offset+2+size);
    offset+=2+size;
  }
  return null;
}
function exifOrder(bytes){if(bytes[0]===0x49&&bytes[1]===0x49&&bytes[2]===42&&bytes[3]===0)return 'le';if(bytes[0]===0x4d&&bytes[1]===0x4d&&bytes[2]===0&&bytes[3]===42)return 'be';return null;}
function exifU16(bytes,order,at){if(at+2>bytes.length)return null;return order==='le'?bytes[at]|bytes[at+1]<<8:bytes[at]<<8|bytes[at+1];}
function exifU32(bytes,order,at){if(at+4>bytes.length)return null;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return order==='le'?view.getUint32(at,true):view.getUint32(at,false);}
export function exifColorSpace(exif){
  if(!(exif instanceof Uint8Array))return null;
  const bytes=exif.length>=6&&String.fromCharCode(...exif.subarray(0,6))==='Exif\0\0'?exif.subarray(6):exif;
  const order=exifOrder(bytes);if(!order)return null;
  const ifd=exifU32(bytes,order,4);if(ifd==null||ifd<8)return null;
  const count=exifU16(bytes,order,ifd);if(count==null||ifd+2+count*12+4>bytes.length)return null;
  let ptr=null;for(let i=0;i<count;i++){const e=ifd+2+i*12;if(exifU16(bytes,order,e)===0x8769){ptr=e;break;}}
  if(ptr==null)return null;
  const type=exifU16(bytes,order,ptr+2),n=exifU32(bytes,order,ptr+4),sub=exifU32(bytes,order,ptr+8);
  if((type!==4&&type!==13)||n!==1||sub==null||sub<8)return null;
  const entries=exifU16(bytes,order,sub);if(entries==null||sub+2+entries*12>bytes.length)return null;
  for(let i=0;i<entries;i++){const e=sub+2+i*12;if(exifU16(bytes,order,e)!==0xa001)continue;if(exifU32(bytes,order,e+4)!==1)return null;const kind=exifU16(bytes,order,e+2);if(kind===3)return exifU16(bytes,order,e+8);if(kind===4){const value=exifU32(bytes,order,e+8);return value!=null&&value<=0xffff?value:null;}return null;}
  return null;
}
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
