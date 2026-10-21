import {undoPiz} from './exr-piz.js';
const COMPRESSION=['none','rle','zips','zip','piz','pxr24','b44','b44a'];
function Reader(bytes){this.bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);this.view=new DataView(this.bytes.buffer,this.bytes.byteOffset,this.bytes.byteLength);this.i=0;}
Reader.prototype.u8=function(){return this.bytes[this.i++];};
Reader.prototype.u32=function(){const v=this.view.getUint32(this.i,true);this.i+=4;return v;};
Reader.prototype.i32=function(){const v=this.view.getInt32(this.i,true);this.i+=4;return v;};
Reader.prototype.f32=function(){const v=this.view.getFloat32(this.i,true);this.i+=4;return v;};
Reader.prototype.u64=function(){const lo=this.u32(),hi=this.u32();return hi*4294967296+lo;};
Reader.prototype.cstr=function(){let s='';while(this.i<this.bytes.length&&this.bytes[this.i])s+=String.fromCharCode(this.bytes[this.i++]);this.i++;return s;};
function halfToFloat(h){const sign=h&0x8000?-1:1,exp=(h>>10)&31,frac=h&1023;if(exp===0)return sign*Math.pow(2,-14)*(frac/1024);if(exp===31)return frac?NaN:sign*Infinity;return sign*Math.pow(2,exp-15)*(1+frac/1024);}
function readChannels(reader,size){const end=reader.i+size,channels=[];while(reader.i<end){const name=reader.cstr();if(!name)break;const type=reader.i32();reader.u8();reader.i+=3;const xSampling=reader.i32(),ySampling=reader.i32();channels.push({name,type,xSampling,ySampling});}reader.i=end;return channels;}
function readHeader(reader){const attrs={};while(reader.i<reader.bytes.length){const name=reader.cstr();if(!name)return attrs;const type=reader.cstr(),size=reader.i32(),start=reader.i;if(type==='chlist')attrs.channels=readChannels(reader,size);else if(type==='box2i')attrs[name]={xMin:reader.i32(),yMin:reader.i32(),xMax:reader.i32(),yMax:reader.i32()};else if(type==='compression'||type==='lineOrder')attrs[name]=reader.u8();else if(type==='string'){let s='';for(let n=0;n<size;n++)s+=String.fromCharCode(reader.u8());attrs[name]=s;}else reader.i=start+size;if(reader.i<start+size)reader.i=start+size;}throw Error('the EXR header does not end');}
export function exrPartHeaders(bytes){
  const reader=new Reader(bytes);
  if(reader.u32()!==0x01312f76)throw Error('not an OpenEXR file');
  const version=reader.u32(),multipart=(version&0x1000)!==0,headers=[];
  if(!multipart)headers.push(readHeader(reader));
  else{for(;;){if(reader.i>=reader.bytes.length)break;if(reader.bytes[reader.i]===0){reader.i++;break;}headers.push(readHeader(reader));}}
  return headers.map((header,index)=>{const box=header.dataWindow||header.displayWindow||{xMin:0,yMin:0,xMax:0,yMax:0};return {index,name:header.name||null,view:header.view||null,width:box.xMax-box.xMin+1,height:box.yMax-box.yMin+1,xMin:box.xMin,yMin:box.yMin,deep:String(header.type||'').startsWith('deep'),compression:header.compression||0,channels:header.channels||[]};});
}
function channelBase(name){const dot=name.lastIndexOf('.');return dot<0?name:name.slice(dot+1);}
function channelSplit(name){const dot=name.lastIndexOf('.');if(dot<=0)return null;return [name.slice(0,dot),name.slice(dot+1)];}
export function exrGroups(parts){
  const groups=[];
  for(const part of parts){if(part.deep)continue;const found=[];for(const channel of part.channels){const split=channelSplit(channel.name);if(!split)continue;const [prefix,base]=split;if(/\d$/.test(prefix))continue;let group=found.find(item=>item.prefix===prefix);if(!group){group={prefix,part:part.index,channels:[],alpha:null};found.push(group);}if(base==='R'||base==='G'||base==='B')group.channels.push(channel.name);else if(base==='A')group.alpha=channel.name;}for(const group of found)if(group.channels.length===3)groups.push(group);}
  return groups;
}
function partName(part){return part.name||'part '+part.index;}
export function exrEntries(bytes){
  const parts=exrPartHeaders(bytes);
  if(!parts.length)throw Error('the EXR has no parts');
  if(parts.every(part=>part.deep))throw Error('this EXR holds only deep parts; it opens through the deep decoder');
  const entries=[];
  for(const part of parts){if(part.deep)continue;entries.push({kind:'part',name:partName(part),view:part.view,width:part.width,height:part.height,channels:part.channels.filter(channel=>['R','G','B','A','Y'].includes(channelBase(channel.name))).length});}
  for(const group of exrGroups(parts))entries.push({kind:'group',name:group.prefix,view:null,width:0,height:0,channels:3+(group.alpha?1:0)});
  return entries;
}
function viewText(view){return view==null?'None':`Some("${view}")`;}
export function exrSelectionPlan(parts,selection){
  const view=selection.view||'both';
  if(!['both','left','right'].includes(view))throw Error('view is "'+view+'"; it is "both", "left" or "right"');
  const groups=exrGroups(parts),passes=itemView=>!itemView||view==='both'||String(itemView).toLowerCase()===view;
  const chosenParts=[];
  for(const want of selection.parts||[]){const part=parts.find(item=>!item.deep&&item.name===want)||parts.find(item=>!item.deep&&!item.name&&partName(item)===want);if(!part)throw Error('no flat part named '+want);if(!passes(part.view))throw Error('the part '+want+' is of the '+viewText(part.view)+' view, the filter is '+view);if(!chosenParts.includes(part))chosenParts.push(part);}
  const chosenGroups=[];
  for(const want of selection.groups||[]){const group=groups.find(item=>item.prefix===want);if(!group)throw Error('no channel group named '+want);const partView=parts[group.part]?.view||null;if(!passes(partView))throw Error('the group '+want+' is of the '+viewText(partView)+' view, the filter is '+view);if(!chosenGroups.includes(group))chosenGroups.push(group);}
  if(!chosenParts.length&&!chosenGroups.length&&!selection.precomp)throw Error('no parts or groups selected');
  return {parts:chosenParts,groups:chosenGroups,view};
}
function colorPlanes(part,planes,only){
  const channels=only?part.channels.filter(channel=>only.includes(channel.name)):part.channels;
  const groups=new Map();
  channels.forEach(channel=>{const split=channelSplit(channel.name),prefix=split?split[0]:'',base=split?split[1]:channel.name;if(!['R','G','B','A','Y'].includes(base))return;if(!groups.has(prefix))groups.set(prefix,{});groups.get(prefix)[base]=planes[part.channels.indexOf(channel)];});
  let best=null,rank=0;
  for(const prefix of [...groups.keys()].sort()){const group=groups.get(prefix);let score=0,candidate=null;if(group.R&&group.G&&group.B){score=group.A?4:3;candidate=[group.R,group.G,group.B,group.A||null];}else if(group.Y){score=group.A?2:1;candidate=[group.Y,group.Y,group.Y,group.A||null];}if(candidate&&score>rank){best=candidate;rank=score;}}
  if(!best)throw Error('no R/G/B or Y channels');
  const count=part.width*part.height,out=new Float32Array(count*4);
  for(let i=0;i<count;i++){out[i*4]=best[0][i];out[i*4+1]=best[1][i];out[i*4+2]=best[2][i];out[i*4+3]=best[3]?best[3][i]:1;}
  return out;
}
function sampleBytes(type){return type===1?2:4;}
function sample(bytes,offset,type){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(type===2)return view.getFloat32(offset,false);if(type===1)return halfToFloat(view.getUint16(offset,false));return view.getUint32(offset,false);}
function chunkLines(part){const compression=part.compression;if(compression===3||compression===5)return 16;if(compression===4||compression===6||compression===7)return 32;return 1;}
function chunkCount(part){return Math.ceil(part.height/chunkLines(part));}
function rowBytes(part){return part.channels.reduce((sum,channel)=>sum+part.width*sampleBytes(channel.type),0);}
function reconstruct(buf){for(let i=1;i<buf.length;i++)buf[i]=(buf[i-1]+buf[i]-128)&255;}
function interleave(source){const out=new Uint8Array(source.length),half=(source.length+1)>>1;let t1=0,t2=half,s=0;while(s<out.length){out[s++]=source[t1++];if(s<out.length)out[s++]=source[t2++];}return out;}
async function inflateZlib(packed){const stream=new DecompressionStream('deflate'),writer=stream.writable.getWriter(),reader=stream.readable.getReader(),chunks=[];const writing=writer.write(packed).then(()=>writer.close());while(true){const step=await reader.read();if(step.done)break;chunks.push(step.value);}await writing;const size=chunks.reduce((sum,chunk)=>sum+chunk.length,0),out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
async function unzip(packed){const inflated=await inflateZlib(packed);reconstruct(inflated);return interleave(inflated);}
function fillPlanes(part,planes,raw,y,rows){let cursor=0;for(let row=0;row<rows;row++){part.channels.forEach((channel,index)=>{const stride=sampleBytes(channel.type);for(let x=0;x<part.width;x++)planes[index][(y-part.yMin+row)*part.width+x]=sample(raw,cursor+x*stride,channel.type);cursor+=part.width*stride;});}}
function unrle(packed,outSize){
  const scratch=new Uint8Array(outSize);let input=0,output=0;
  while(input<packed.length){const code=packed[input]<128?packed[input]:packed[input]-256;input++;if(code<0){const count=-code;if(input+count>packed.length||output+count>outSize)throw Error('the EXR RLE block is truncated');scratch.set(packed.subarray(input,input+count),output);input+=count;output+=count;}else{const count=code+1;if(input>=packed.length||output+count>outSize)throw Error('the EXR RLE block is truncated');scratch.fill(packed[input],output,output+count);input++;output+=count;}}
  if(output!==outSize)throw Error('the EXR RLE block is shorter than its channels');
  reconstruct(scratch);return interleave(scratch);
}
async function readPart(bytes,part){
  if(part.deep||part.channels.some(channel=>channel.xSampling!==1||channel.ySampling!==1))throw Error('only flat scanlines with sampling 1 are decoded');
  if(![0,1,2,3,4].includes(part.compression))throw Error('unsupported EXR compression '+(COMPRESSION[part.compression]||part.compression));
  const lines=chunkLines(part),reader=new Reader(bytes);reader.i=part.dataOffset;const offsets=[];for(let i=0;i<chunkCount(part);i++)offsets.push(reader.u64());
  const planes=part.channels.map(()=>new Float32Array(part.width*part.height)),stride=rowBytes(part);
  for(const offset of offsets){reader.i=offset;const y=reader.i32(),size=reader.i32(),packed=bytes.subarray(reader.i,reader.i+size),rows=Math.min(lines,part.height-(y-part.yMin)),expect=rows*stride;const raw=part.compression===0?packed:part.compression===1?unrle(packed,expect):part.compression===4?undoPiz(packed,part.channels,part.width,rows):await unzip(packed);if(raw.length<expect)throw Error('the EXR scanline is shorter than its channels');fillPlanes(part,planes,raw,y,rows);}
  return planes;
}
function dataOffsets(bytes){
  const parts=exrPartHeaders(bytes),reader=new Reader(bytes);
  reader.u32();const version=reader.u32();
  if((version&0x1000)===0)readHeader(reader);else{for(;;){if(reader.bytes[reader.i]===0){reader.i++;break;}readHeader(reader);}}
  for(const part of parts){part.dataOffset=reader.i;for(let row=0;row<chunkCount(part);row++)reader.u64();}
  return parts;
}
const PRECOMP_REQUIRED=['directdiffuse','indirectdiffuse','directspecular','indirectspecular','emission'];
const PRECOMP_OPTIONAL=['transmission','sss','volume'];
function normalizeAov(name){return name.replace(/[^0-9A-Za-z]/g,'').toLowerCase();}
async function precompLayer(bytes,parts){
  const groups=exrGroups(parts),have=groups.map(group=>normalizeAov(group.prefix)),missing=PRECOMP_REQUIRED.filter(name=>!have.includes(name));
  if(missing.length)throw Error('the AOV set is incomplete for a beauty precomp; missing: '+missing.join(', '));
  let width=0,height=0,sum=null,alpha=null;
  for(const group of groups){const key=normalizeAov(group.prefix);if(!PRECOMP_REQUIRED.includes(key)&&!PRECOMP_OPTIONAL.includes(key))continue;const part=parts[group.part],planes=await readPart(bytes,part),names=[...group.channels];if(group.alpha)names.push(group.alpha);const rgba=colorPlanes(part,planes,names);if(!width){width=part.width;height=part.height;sum=new Float32Array(width*height*3);alpha=new Float32Array(width*height);}else if(width!==part.width||height!==part.height)throw Error('the AOV groups differ in size; a beauty precomp needs one common extent');for(let i=0;i<width*height;i++){sum[i*3]+=rgba[i*4];sum[i*3+1]+=rgba[i*4+1];sum[i*3+2]+=rgba[i*4+2];alpha[i]=Math.max(alpha[i],rgba[i*4+3]);}}
  if(!width)throw Error('the AOV groups are empty');
  const rgba=new Float32Array(width*height*4);
  for(let i=0;i<width*height;i++){const a=alpha[i];rgba[i*4]=a?sum[i*3]/a:0;rgba[i*4+1]=a?sum[i*3+1]/a:0;rgba[i*4+2]=a?sum[i*3+2]/a:0;rgba[i*4+3]=a;}
  return {name:'beauty (precomp)',width,height,rgba,warning:'beauty (precomp) is the additive sum of the file\'s AOVs; alpha is the maximum coverage'};
}
export async function decodeExrSelection(bytes,selection){
  const parts=dataOffsets(bytes),plan=exrSelectionPlan(parts,selection),layers=[],warnings=[];
  for(const part of plan.parts)layers.push({name:partName(part),width:part.width,height:part.height,rgba:colorPlanes(part,await readPart(bytes,part))});
  for(const group of plan.groups){const part=parts[group.part],planes=await readPart(bytes,part),names=[...group.channels];if(group.alpha)names.push(group.alpha);layers.push({name:group.prefix,width:part.width,height:part.height,rgba:colorPlanes(part,planes,names)});}
  if(selection?.precomp){const layer=await precompLayer(bytes,parts);layers.push(layer);warnings.push(layer.warning);}
  if(!layers.length)throw Error('nothing imported');
  return {width:Math.max(...layers.map(layer=>layer.width)),height:Math.max(...layers.map(layer=>layer.height)),layers,warnings};
}
