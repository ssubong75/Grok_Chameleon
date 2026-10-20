// Photoshop .pat (8BPT): RGB 8-bit planes, raw or PackBits, optional alpha.

function u16(bytes,p){return (bytes[p]<<8)|bytes[p+1];}
function u32(bytes,p){return ((bytes[p]<<24)|(bytes[p+1]<<16)|(bytes[p+2]<<8)|bytes[p+3])>>>0;}
function i32(bytes,p){const v=u32(bytes,p);return v>0x7fffffff?v-0x100000000:v;}
function put16(out,v){out.push((v>>8)&255,v&255);}
function put32(out,v){out.push((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255);}

function packbits(row){
  const out=[];let i=0;
  while(i<row.length){
    let run=1;while(i+run<row.length&&row[i+run]===row[i]&&run<128)run++;
    if(run>=2){out.push(257-run,row[i]);i+=run;continue;}
    let n=1;while(i+n<row.length&&n<128){let r=1;while(i+n+r<row.length&&row[i+n+r]===row[i+n]&&r<3)r++;if(r>=3)break;n++;}
    out.push(n-1,...row.slice(i,i+n));i+=n;
  }
  return out;
}
function unpackbits(data,length){
  const out=[];let i=0;
  while(out.length<length&&i<data.length){
    const n=data[i++];
    if(n<128){const count=n+1;out.push(...data.slice(i,i+count));i+=count;}
    else if(n>128){const count=257-n;out.push(...Array(count).fill(data[i++]));}
  }
  if(out.length<length)out.push(...Array(length-out.length).fill(0));
  return out.slice(0,length);
}
function encodePlane(plane,w,h){
  const rows=[];let body=[];
  for(let y=0;y<h;y++){const packed=packbits(plane.slice(y*w,(y+1)*w));rows.push(packed.length);body=body.concat(packed);}
  const out=[];for(const n of rows)put16(out,n);out.push(...body);return out;
}
function decodePlane(data,w,h,compression){
  if(compression===0)return data.slice(0,w*h);
  let p=0;const lengths=[];for(let y=0;y<h;y++){lengths.push(u16(data,p));p+=2;}
  const out=[];
  for(const n of lengths){out.push(...unpackbits(data.slice(p,p+n),w));p+=n;}
  return out;
}

export function writePat(patterns){
  const out=[...'8BPT'].map(c=>c.charCodeAt(0));
  put16(out,1);put32(out,patterns.length);
  for(const pattern of patterns){
    const w=pattern.width,h=pattern.height,channels=pattern.channels||3;
    put32(out,1);put32(out,3);put16(out,h);put16(out,w);
    const units=[...pattern.name].map(ch=>ch.charCodeAt(0)).concat(0);
    put32(out,units.length);for(const u of units)put16(out,u);
    const id=new TextEncoder().encode(pattern.id||crypto.randomUUID()).slice(0,255);
    out.push(id.length,...id);
    const body=[];
    for(const v of [0,0,h,w])put32(body,v);
    put32(body,24);
    const planes=[];
    for(let c=0;c<channels;c++){const plane=[];for(let i=0;i<w*h;i++)plane.push(pattern.pixels[i*channels+c]);planes.push(plane);}
    const alpha=channels===4?planes.pop():null;
    const array=plane=>{put32(body,1);const data=encodePlane(plane,w,h);put32(body,23+data.length);put32(body,8);for(const v of [0,0,h,w])put32(body,v);put16(body,8);body.push(1,...data);};
    for(const plane of planes)array(plane);
    for(let i=planes.length;i<24;i++)put32(body,0);
    if(alpha)array(alpha);else put32(body,0);
    put32(body,0);
    put32(out,3);put32(out,body.length);out.push(...body);
  }
  return Uint8Array.from(out);
}

export function readPat(bytes){
  const data=bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes);
  if(data.length<10||String.fromCharCode(...data.slice(0,4))!=='8BPT')throw Error('not a readable .pat file');
  let p=6;const count=u32(data,p);p+=4;const patterns=[];
  for(let n=0;n<count&&n<100000;n++){
    if(u32(data,p)!==1)throw Error('pattern version');
    p+=4;const mode=u32(data,p);p+=4;const height=u16(data,p),width=u16(data,p+2);p+=4;
    const nameLen=u32(data,p);p+=4;let name='';for(let i=0;i<nameLen;i++){const u=u16(data,p);p+=2;if(u)name+=String.fromCharCode(u);}
    const idLen=data[p++];const id=new TextDecoder().decode(data.slice(p,p+idLen));p+=idLen;
    if(mode===2)p+=768;
    if(u32(data,p)!==3)throw Error('virtual memory array list version');
    p+=4;const len=u32(data,p);p+=4;const body=data.slice(p,p+len);p+=len;
    let v=16;const slots=u32(body,v);v+=4;const planes=[];
    const readArray=()=>{
      if(v+4>body.length)return null;
      if(u32(body,v)===0){v+=4;return null;}
      v+=4;const alen=u32(body,v);v+=4;if(alen<23)throw Error('short virtual memory array');
      v+=4;const top=i32(body,v),left=i32(body,v+4),bottom=i32(body,v+8),right=i32(body,v+12);v+=16;
      const depth=u16(body,v);v+=2;const comp=body[v++];const raw=body.slice(v,v+alen-23);v+=alen-23;
      if(depth!==8)throw Error('pattern depth '+depth);
      return decodePlane(raw,right-left,bottom-top,comp);
    };
    for(let i=0;i<slots&&v<body.length;i++){const plane=readArray();if(plane)planes.push(plane);}
    while(v+4<=body.length){const plane=readArray();if(plane)planes.push(plane);}
    const color=planes.slice(0,Math.min(3,planes.length)),alpha=planes.length>3?planes.at(-1):null;
    const channels=alpha?4:3,pixels=[];
    for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)pixels.push(color[c]?.[i]||0);if(alpha)pixels.push(alpha[i]);}
    patterns.push({id,name,width,height,channels,pixels});
  }
  return patterns;
}
