// PhotoCraft psd/path.rs and io/psd_export.rs, commit 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and contributors. MIT; see vendor/photocraft.LICENSE-MIT.
import {pathContours} from './paths.js';
const bytesOf=value=>ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value);
function resources(value){
  const bytes=bytesOf(value),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(bytes.length<34)throw Error('Truncated PSD resource section.');const start=30+view.getUint32(26);if(start+4>bytes.length)throw Error('Invalid PSD color-data length.');const end=start+4+view.getUint32(start);if(end>bytes.length)throw Error('Invalid PSD resource length.');return{bytes,view,start,end};
}
function blocks(section){
  const {view,start,end}=section,out=[];let p=start+4;
  while(p<end){if(p+7>end||view.getUint32(p)!==0x3842494d)throw Error('Invalid PSD resource block.');const id=view.getUint16(p+4),nameLength=view.getUint8(p+6),nameEnd=p+6+((1+nameLength+1)&~1);if(nameEnd+4>end)throw Error('Invalid PSD resource name.');const length=view.getUint32(nameEnd),dataStart=nameEnd+4,blockEnd=dataStart+length+(length&1);if(blockEnd>end)throw Error('Invalid PSD resource data.');out.push({id,nameStart:p+7,nameLength,dataStart,length,start:p,end:blockEnd});p=blockEnd;}return out;
}
function decodePath(data,w,h,name){
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength),contours=[];let contour=null,total=0,inverted=false;
  for(let p=0;p+26<=data.length;p+=26){const selector=view.getUint16(p);
    if(selector===8){inverted=view.getUint16(p+2)!==0;continue;}
    if(selector===0||selector===3){contour={closed:selector===0,nodes:[],operation:view.getInt16(p+4)};contours.push(contour);}
    else if([1,2,4,5].includes(selector)){
      if(!contour){contour={closed:selector<=2,nodes:[],operation:1};contours.push(contour);}const pair=i=>({x:view.getInt32(p+6+i*8)/16777216*w,y:view.getInt32(p+2+i*8)/16777216*h}),a=pair(0),b=pair(1),c=pair(2);contour.nodes.push({x:b.x,y:b.y,inX:a.x,inY:a.y,outX:c.x,outY:c.y,smooth:selector===1||selector===4});if(++total>10000)throw Error('Saved path exceeds the current anchor limit.');
    }
  }
  const nonempty=contours.filter(c=>c.nodes.length);if(!nonempty.length)return null;if(inverted||!nonempty.every(c=>[0,1,-1].includes(c.operation))||nonempty.some(c=>c.operation===0)&&!nonempty.every(c=>c.operation===0))throw Error('Saved path uses unsupported initial fill or compound operations.');
  const [first,...rest]=nonempty,clean=c=>({closed:c.closed,nodes:c.nodes});return{id:crypto.randomUUID(),name,...clean(first),subpaths:rest.map(clean),fillRule:first.operation===0?'evenodd':'nonzero'};
}
export function readPsdPaths(value,w,h){
  const section=resources(value),paths=[],notes=[];for(const block of blocks(section)){
    if(block.id!==1025&&(block.id<2000||block.id>2997))continue;
    const rawName=section.bytes.subarray(block.nameStart,block.nameStart+block.nameLength),name=block.id===1025?'Work Path':new TextDecoder('macintosh').decode(rawName)||'Path';
    try{const path=decodePath(section.bytes.subarray(block.dataStart,block.dataStart+block.length),w,h,name);if(path)paths.push({...path,psdWorkPath:block.id===1025});}catch(error){notes.push(name+': '+error.message);}
  }return{paths,notes};
}
function pathData(path,w,h){
  const contours=pathContours(path).filter(c=>c.nodes?.length),nodes=contours.reduce((n,c)=>n+c.nodes.length,0);if(nodes>10000)throw Error('Saved path exceeds the current anchor limit.');const data=new Uint8Array((2+contours.length+nodes)*26),view=new DataView(data.buffer);view.setUint16(0,6);view.setUint16(26,8);let p=52;
  const fixed=v=>{if(!Number.isFinite(v)||v< -128||v>=128)throw Error('A path coordinate exceeds PSD fixed-point limits.');const value=v*16777216;return Math.max(-2147483648,Math.min(2147483647,value<0?-Math.round(-value):Math.round(value)));};
  for(const contour of contours){view.setUint16(p,contour.closed?0:3);view.setUint16(p+2,contour.nodes.length);view.setInt16(p+4,path.fillRule==='evenodd'?0:1);view.setUint16(p+6,1);p+=26;
    for(const node of contour.nodes){view.setUint16(p,contour.closed?(node.smooth?1:2):(node.smooth?4:5));for(const [i,x,y]of [[0,node.inX??node.x,node.inY??node.y],[1,node.x,node.y],[2,node.outX??node.x,node.outY??node.y]]){view.setInt32(p+2+i*8,fixed(y/h));view.setInt32(p+6+i*8,fixed(x/w));}p+=26;}
  }return data;
}
function resource(path,id,w,h){
  const name=Array.from(String(path.name||'Path')).slice(0,255).map(c=>c.length===1&&c.charCodeAt(0)>=32&&c.charCodeAt(0)<=126?c.charCodeAt(0):63),nameLength=(1+name.length+1)&~1,data=pathData(path,w,h),bytes=new Uint8Array(6+nameLength+4+data.length+(data.length&1)),view=new DataView(bytes.buffer);view.setUint32(0,0x3842494d);view.setUint16(4,id);bytes[6]=name.length;bytes.set(name,7);view.setUint32(6+nameLength,data.length);bytes.set(data,10+nameLength);return bytes;
}
export function writePsdPaths(value,paths,w,h){
  if(!paths?.length)return value;const work=paths.findIndex(path=>path.psdWorkPath);if(paths.length-(work>=0?1:0)>998)throw Error('PSD supports up to 998 saved paths and one work path.');let saved=0;const section=resources(value),kept=blocks(section).filter(b=>b.id!==1025&&(b.id<2000||b.id>2997)).map(b=>section.bytes.subarray(b.start,b.end)),added=paths.map((path,i)=>resource(path,i===work?1025:2000+saved++,w,h)),chunks=[...kept,...added],length=chunks.reduce((n,c)=>n+c.length,0);if(length>0xffffffff)throw Error('PSD resources exceed the format limit.');
  const result=new Uint8Array(section.start+4+length+section.bytes.length-section.end);result.set(section.bytes.subarray(0,section.start));new DataView(result.buffer).setUint32(section.start,length);let p=section.start+4;for(const chunk of chunks){result.set(chunk,p);p+=chunk.length;}result.set(section.bytes.subarray(section.end),p);return result.buffer;
}
export const psdResourceSection=resources;
export function readPsdResource(value,id){const section=resources(value),block=blocks(section).find(b=>b.id===id);return block?section.bytes.subarray(block.dataStart,block.dataStart+block.length):null;}
const guideList=guides=>(guides||[]).filter(guide=>guide&&(guide.axis==='vertical'||guide.axis==='horizontal')&&Number.isFinite(guide.position));
export function guidesResource(guides){const ordered=[...guideList(guides).filter(guide=>guide.axis==='vertical'),...guideList(guides).filter(guide=>guide.axis==='horizontal')],data=new Uint8Array(16+ordered.length*5),view=new DataView(data.buffer);view.setUint32(0,1);view.setUint32(4,576);view.setUint32(8,576);view.setUint32(12,ordered.length);ordered.forEach((guide,index)=>{const at=16+index*5,fixed=Math.max(-2147483648,Math.min(2147483647,Math.round(guide.position*32)));view.setInt32(at,fixed);data[at+4]=guide.axis==='horizontal'?1:0;});return data;}
export function readPsdGuides(value){const data=readPsdResource(value,1032);if(!data||data.length<16)return [];const view=new DataView(data.buffer,data.byteOffset,data.byteLength);if(view.getUint32(0)!==1)return [];const count=view.getUint32(12);if(!Number.isSafeInteger(count)||16+count*5>data.length)throw Error('Truncated guide resource.');const guides=[];for(let i=0;i<count;i++){const at=16+i*5;guides.push({axis:data[at+4]?'horizontal':'vertical',position:view.getInt32(at)/32});}return guides;}
export function writePsdGuides(value,guides){const list=guideList(guides);if(!list.length)return value;return replacePsdResources(value,[{id:1032,data:guidesResource(list)}]);}
export function replacePsdResources(value,additions){
  const section=resources(value),ids=new Set(additions.map(a=>a.id)),chunks=blocks(section).filter(b=>!ids.has(b.id)).map(b=>section.bytes.subarray(b.start,b.end));
  for(const {id,data}of additions){const block=new Uint8Array(12+data.length+(data.length&1)),view=new DataView(block.buffer);view.setUint32(0,0x3842494d);view.setUint16(4,id);view.setUint32(8,data.length);block.set(data,12);chunks.push(block);}
  const length=chunks.reduce((n,c)=>n+c.length,0);if(length>0xffffffff)throw Error('PSD resources exceed the format limit.');const output=new Uint8Array(section.start+4+length+section.bytes.length-section.end);output.set(section.bytes.subarray(0,section.start));new DataView(output.buffer).setUint32(section.start,length);let p=section.start+4;for(const chunk of chunks){output.set(chunk,p);p+=chunk.length;}output.set(section.bytes.subarray(section.end),p);return output.buffer;
}
