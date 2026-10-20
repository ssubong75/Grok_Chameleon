import {readPsdResource,replacePsdResources} from './psd-paths.js';
export function validateProfile(value){
  const data=new Uint8Array(value);if(data.length<132||data.length>16777216)throw Error('ICC profile size is invalid.');const view=new DataView(data.buffer,data.byteOffset,data.byteLength),size=view.getUint32(0);if(size<132||size>data.length||view.getUint32(36)!==0x61637370)throw Error('Invalid ICC profile header.');const count=view.getUint32(128);if(count>4096||132+count*12>size)throw Error('Invalid ICC tag table.');for(let i=0;i<count;i++){const offset=view.getUint32(136+i*12),length=view.getUint32(140+i*12);if(offset>size||length>size-offset)throw Error('Invalid ICC tag range.');}return data.slice(0,size);
}
export function readPsdProfile(bytes){const data=readPsdResource(bytes,1039);return data?validateProfile(data):null;}
export function writePsdProfile(bytes,profile){return profile?replacePsdResources(bytes,[{id:1039,data:validateProfile(profile)}]):bytes;}
