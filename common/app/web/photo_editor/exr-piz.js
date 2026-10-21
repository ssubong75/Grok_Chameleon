import {hufCompress,hufDecompress} from './exr-huf.js';
function i16(value){return (value<<16)>>16;}
function u16(value){return value&65535;}
function wenc14(a,b){const as=i16(a),bs=i16(b),ms=(as+bs)>>1,ds=as-bs;return [u16(ms),u16(ds)];}
function wdec14(l,h){const hi=i16(h),li=i16(l),ai=li+(hi&1)+(hi>>1);return [u16(ai),u16(ai-hi)];}
function wdec144(px,p01,p10,p11){
  const a=i16(px),b=i16(p10),c=i16(p01),d=i16(p11);
  const i00=a+(b&1)+(b>>1),i10=i00-b,i01=c+(d&1)+(d>>1),i11=i01-d;
  const ai=i00+(i01&1)+(i01>>1),bi=ai-i01,ci=i10+(i11&1)+(i11>>1),di=ci-i11;
  return [u16(ai),u16(bi),u16(ci),u16(di)];
}
const A_OFFSET=1<<15,M_OFFSET=1<<15,MOD_MASK=(1<<16)-1;
function wenc16(a,b){const ao=(a+A_OFFSET)&MOD_MASK;let m=(ao+b)>>1,d=ao-b;if(d<0)m=(m+M_OFFSET)&MOD_MASK;return [u16(m),u16(d&MOD_MASK)];}
function wdec16(l,h){const m=l,d=h,bb=(m-(d>>1))&MOD_MASK,aa=(d+bb-A_OFFSET)&MOD_MASK;return [u16(aa),u16(bb)];}
export function wav2dEncode(data,nx,ox,ny,oy,mx,base=0){
  const w14=mx<(1<<14);
  const n=nx>ny?ny:nx;let p=1,p2=2;
  while(p2<=n){
    const oy1=oy*p,oy2=oy*p2,ox1=ox*p,ox2=ox*p2;
    let py=0,ey=oy*(ny-p2);
    for(;py<=ey;py+=oy2){
      let px=py,ex=py+ox*(nx-p2);
      for(;px<=ex;px+=ox2){
        const p01=px+ox1,p10=px+oy1,p11=p10+ox1;
        const enc=w14?wenc14:wenc16;
        const [i00,i01]=enc(data[base+px],data[base+p01]);
        const [i10,i11]=enc(data[base+p10],data[base+p11]);
        const [a,b]=enc(i00,i10);data[base+px]=a;data[base+p10]=b;
        const [c,d]=enc(i01,i11);data[base+p01]=c;data[base+p11]=d;
      }
      if(nx&p){const p10=px+oy1,enc=w14?wenc14:wenc16,[a,b]=enc(data[base+px],data[base+p10]);data[base+px]=a;data[base+p10]=b;}
    }
    if(ny&p){let px=py,ex=py+ox*(nx-p2);for(;px<=ex;px+=ox2){const p01=px+ox1,enc=w14?wenc14:wenc16,[a,b]=enc(data[base+px],data[base+p01]);data[base+px]=a;data[base+p01]=b;}}
    p=p2;p2<<=1;
  }
}
export function wav2dDecode(data,nx,ox,ny,oy,mx,base=0){
  const w14=mx<(1<<14);
  const n=nx>ny?ny:nx;let p=1;
  while(p<=n)p<<=1;
  p>>=1;let p2=p;p>>=1;
  while(p>=1){
    const oy1=oy*p,oy2=oy*p2,ox1=ox*p,ox2=ox*p2;
    let py=0,ey=oy*(ny-p2);
    for(;py<=ey;py+=oy2){
      let px=py,ex=py+ox*(nx-p2);
      for(;px<=ex;px+=ox2){
        const p01=px+ox1,p10=px+oy1,p11=p10+ox1;
        if(w14){const [a,b,c,d]=wdec144(data[base+px],data[base+p01],data[base+p10],data[base+p11]);data[base+px]=a;data[base+p01]=b;data[base+p10]=c;data[base+p11]=d;}
        else{const [i00,i10]=wdec16(data[base+px],data[base+p10]);const [i01,i11]=wdec16(data[base+p01],data[base+p11]);const [a,b]=wdec16(i00,i01);const [c,d]=wdec16(i10,i11);data[base+px]=a;data[base+p01]=b;data[base+p10]=c;data[base+p11]=d;}
      }
      if(nx&p){const p10=px+oy1,dec=w14?wdec14:wdec16,[a,b]=dec(data[base+px],data[base+p10]);data[base+px]=a;data[base+p10]=b;}
    }
    if(ny&p){let px=py,ex=py+ox*(nx-p2);for(;px<=ex;px+=ox2){const p01=px+ox1,dec=w14?wdec14:wdec16,[a,b]=dec(data[base+px],data[base+p01]);data[base+px]=a;data[base+p01]=b;}}
    p2=p;p>>=1;
  }
}
const BITMAP_SIZE=8192,USHORT_RANGE=65536;
function bytesPerChannel(channel){return channel.type===1?2:4;}
function bitmapFromData(data){
  const bitmap=new Uint8Array(BITMAP_SIZE);
  for(let i=0;i<data.length;i++)bitmap[data[i]>>3]|=1<<(data[i]&7);
  bitmap[0]&=~1;
  let minNonZero=BITMAP_SIZE-1,maxNonZero=0;
  for(let i=0;i<BITMAP_SIZE;i++)if(bitmap[i]){if(minNonZero>i)minNonZero=i;if(maxNonZero<i)maxNonZero=i;}
  return {bitmap,minNonZero,maxNonZero};
}
function forwardLut(bitmap){const lut=new Uint16Array(USHORT_RANGE);let k=0;for(let i=0;i<USHORT_RANGE;i++)if(i===0||(bitmap[i>>3]&(1<<(i&7))))lut[i]=k++;return {lut,max:k-1};}
function reverseLut(bitmap){const lut=new Uint16Array(USHORT_RANGE);let k=0;for(let i=0;i<USHORT_RANGE;i++)if(i===0||(bitmap[i>>3]&(1<<(i&7))))lut[k++]=i;return {lut,max:k-1};}
function applyLut(lut,data){for(let i=0;i<data.length;i++)data[i]=lut[data[i]];}
function toNative(raw,channels,width,height){
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),row=channels.reduce((sum,channel)=>sum+width*bytesPerChannel(channel),0);
  let count=0;for(const channel of channels)count+=width*height*(bytesPerChannel(channel)/2);
  const data=new Uint16Array(count);let plane=0,channelRow=0;
  for(const channel of channels){const words=width*(bytesPerChannel(channel)/2),rowBytes=width*bytesPerChannel(channel);for(let y=0;y<height;y++){let src=y*row+channelRow;for(let x=0;x<words;x++)data[plane++]=view.getUint16(src+x*2,false);}channelRow+=rowBytes;}
  return data;
}
function fromNative(data,channels,width,height){
  const row=channels.reduce((sum,channel)=>sum+width*bytesPerChannel(channel),0),out=new Uint8Array(row*height),view=new DataView(out.buffer);
  let plane=0,channelRow=0;
  for(const channel of channels){const words=width*(bytesPerChannel(channel)/2),rowBytes=width*bytesPerChannel(channel);for(let y=0;y<height;y++){let dst=y*row+channelRow;for(let x=0;x<words;x++)view.setUint16(dst+x*2,data[plane++],false);}channelRow+=rowBytes;}
  return out;
}
function wave(data,channels,width,height,maxValue,encode){
  let offset=0;
  for(const channel of channels){const wcount=bytesPerChannel(channel)/2;for(let j=0;j<wcount;j++)(encode?wav2dEncode:wav2dDecode)(data,width,wcount,height,wcount*width,maxValue,offset+j);offset+=width*height*wcount;}
}
export function applyPiz(raw,channels,width,height){
  const native=toNative(raw,channels,width,height),bits=bitmapFromData(native),range=forwardLut(bits.bitmap);
  applyLut(range.lut,native);wave(native,channels,width,height,range.max,true);
  const huf=hufCompress(native),span=bits.minNonZero<=bits.maxNonZero?bits.maxNonZero-bits.minNonZero+1:0,total=8+span+huf.length;
  if(total>=raw.length)return raw;
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint16(0,bits.minNonZero,true);view.setUint16(2,bits.maxNonZero,true);
  if(span)out.set(bits.bitmap.subarray(bits.minNonZero,bits.maxNonZero+1),4);
  view.setUint32(4+span,huf.length,true);out.set(huf,8+span);return out;
}
export function undoPiz(packed,channels,width,height){
  const expect=channels.reduce((sum,channel)=>sum+width*height*bytesPerChannel(channel),0);
  if(packed.length===expect)return packed;
  if(packed.length<8)throw Error('corrupt piz chunk');
  const view=new DataView(packed.buffer,packed.byteOffset,packed.byteLength);
  const minNonZero=view.getUint16(0,true),maxNonZero=view.getUint16(2,true);
  if(maxNonZero>=BITMAP_SIZE)throw Error('corrupt piz chunk');
  const bitmap=new Uint8Array(BITMAP_SIZE);let n=4;
  if(minNonZero<=maxNonZero){const span=maxNonZero-minNonZero+1;if(n+span>packed.length)throw Error('corrupt piz chunk');bitmap.set(packed.subarray(n,n+span),minNonZero);n+=span;}
  const range=reverseLut(bitmap);
  if(n+4>packed.length)throw Error('corrupt piz chunk');
  const hufBytes=view.getUint32(n,true);n+=4;
  if(n+hufBytes>packed.length)throw Error('corrupt piz chunk');
  const data=hufDecompress(packed.subarray(n,n+hufBytes),expect/2);
  wave(data,channels,width,height,range.max,false);applyLut(range.lut,data);return fromNative(data,channels,width,height);
}
