// OpenType name / OS/2 / fvar metadata; no font outlines are parsed.
// https://learn.microsoft.com/en-us/typography/opentype/spec/name
// https://learn.microsoft.com/en-us/typography/opentype/spec/otff
const fs=require('node:fs');
const {TextDecoder}=require('node:util');
function fontMetadata(file){
  let fd;
  try{
    const size=fs.statSync(file).size;if(size<12||size>128*1024*1024)return[];fd=fs.openSync(file,'r');
    const read=(offset,length)=>{if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||length>4*1024*1024||offset+length>size)throw Error('Invalid OpenType table range.');const data=Buffer.alloc(length);let count=0;while(count<length){const n=fs.readSync(fd,data,count,length-count,offset+count);if(!n)throw Error('Truncated OpenType table.');count+=n;}return data;};
    const header=read(0,12),collection=header.toString('ascii',0,4)==='ttcf',count=collection?header.readUInt32BE(8):1;if(count<1||count>256)return[];const offsets=collection?read(12,count*4):null,faces=[];
    for(let faceIndex=0;faceIndex<count;faceIndex++){
      try{
        const offset=collection?offsets.readUInt32BE(faceIndex*4):0,head=read(offset,12),signature=head.readUInt32BE(0),tables=head.readUInt16BE(4);if(![0x00010000,0x4f54544f,0x74727565].includes(signature)||tables>4096)continue;const directory=read(offset+12,tables*16),records=new Map();for(let i=0;i<tables;i++)records.set(directory.toString('ascii',i*16,i*16+4),{offset:directory.readUInt32BE(i*16+8),length:directory.readUInt32BE(i*16+12)});
        const table=tag=>{const entry=records.get(tag);return entry?read(entry.offset,entry.length):null;},names=table('name');if(!names||names.length<6)continue;const nameCount=names.readUInt16BE(2),storage=names.readUInt16BE(4);if(6+nameCount*12>names.length)continue;const values=new Map(),aliases=new Set(),nativeNames=[];
        for(let i=0;i<nameCount;i++){
          const p=6+i*12,platform=names.readUInt16BE(p),encoding=names.readUInt16BE(p+2),language=names.readUInt16BE(p+4),id=names.readUInt16BE(p+6),length=names.readUInt16BE(p+8),start=storage+names.readUInt16BE(p+10);if(![1,2,4,6,16,17].includes(id)||start+length>names.length||length>4096)continue;
          let value;try{const bytes=names.subarray(start,start+length);if(platform===0||platform===3&&[0,1,10].includes(encoding))value=new TextDecoder('utf-16be').decode(bytes);else if(platform===1&&encoding===0)value=new TextDecoder('macintosh').decode(bytes);else continue;}catch(_){continue;}value=value.replace(/\0/g,'').trim();if(!value||/[\x00-\x1f]/.test(value))continue;
          if([1,16].includes(id)&&platform===3&&language!==0&&(language&1023)!==9)nativeNames.push({id,value});
          const score=(platform===3&&language===0x409?100:platform===1&&language===0?90:platform===0?80:20)+(platform===3?5:0);if(!values.has(id)||values.get(id).score<score)values.set(id,{value,score});if([1,4,6,16].includes(id))aliases.add(value);
        }
        const name=id=>values.get(id)?.value,family=name(1)||name(16);if(!family)continue;const os2=table('OS/2'),fontHead=table('head'),subfamily=name(17)||name(2)||'Regular',weight=os2?.length>=8?Math.max(1,Math.min(1000,os2.readUInt16BE(4))):400,selection=os2?.length>=64?os2.readUInt16BE(62):0,macStyle=fontHead?.length>=46?fontHead.readUInt16BE(44):0,style=selection&1||selection&512||macStyle&2?'italic':'normal';let weightMin=weight,weightMax=weight;
        const fvar=table('fvar');if(fvar?.length>=16){const start=fvar.readUInt16BE(4),axes=fvar.readUInt16BE(8),stride=fvar.readUInt16BE(10);if(stride>=20&&axes<=256&&start+axes*stride<=fvar.length)for(let i=0;i<axes;i++){const p=start+i*stride;if(fvar.toString('ascii',p,p+4)==='wght'){weightMin=Math.max(1,Math.min(1000,fvar.readInt32BE(p+4)/65536));weightMax=Math.max(weightMin,Math.min(1000,fvar.readInt32BE(p+12)/65536));}}}
        const localizedFamily=(nativeNames.find(n=>n.id===16&&n.value!==family)||nativeNames.find(n=>n.id===1&&n.value!==family))?.value;
        faces.push({localizedFamily,faceIndex,collection,family,subfamily,fullName:name(4)||family,postscript:name(6)||'',aliases:[...aliases],weight,weightMin,weightMax,style});
      }catch(_){/* One unreadable collection face does not hide the others. */}
    }return faces;
  }catch(_){return[];}finally{if(fd!=null)fs.closeSync(fd);}
}
module.exports={fontMetadata};
