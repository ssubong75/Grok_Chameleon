const HUF_DECBITS=14,HUF_DECSIZE=1<<HUF_DECBITS,HUF_DECMASK=HUF_DECSIZE-1,HUF_ENCSIZE=(1<<16)+1;
const SHORT_ZEROCODE_RUN=59,LONG_ZEROCODE_RUN=63,SHORTEST_LONG_RUN=2+LONG_ZEROCODE_RUN-SHORT_ZEROCODE_RUN;
const lenOf=code=>Number(code&63n);
const codeOf=code=>code>>6n;
function canonical(lengths){
  const n=Array(59).fill(0n);
  for(const length of lengths)n[length]+=1n;
  let c=0n;
  for(let i=58;i>0;i--){const nc=(c+n[i])>>1n;n[i]=c;c=nc;}
  return lengths.map(length=>length?BigInt(length)|(n[length]++<<6n):0n);
}
function outputBits(nBits,bits,state){
  state.c=(state.c<<BigInt(nBits))|BigInt(bits);
  state.lc+=nBits;
  while(state.lc>=8){state.lc-=8;state.out.push(Number((state.c>>BigInt(state.lc))&255n));}
}
function flushBits(state){if(state.lc>0)state.out.push(Number((state.c<<BigInt(8-state.lc))&255n));}
export function packCodeLengths(lengths){
  const state={c:0n,lc:0,out:[]};let i=0;
  while(i<lengths.length){
    const length=lengths[i];
    if(length===0){let run=1;while(i+1<lengths.length&&lengths[i+1]===0&&run<255+SHORTEST_LONG_RUN){i++;run++;}
      if(run>=2){if(run>=SHORTEST_LONG_RUN){outputBits(6,LONG_ZEROCODE_RUN,state);outputBits(8,run-SHORTEST_LONG_RUN,state);}else outputBits(6,SHORT_ZEROCODE_RUN+run-2,state);i++;continue;}}
    outputBits(6,length,state);i++;
  }
  flushBits(state);
  return Uint8Array.from(state.out);
}
function getBits(nBits,state){
  while(state.lc<nBits){state.c=(state.c<<8n)|BigInt(state.bytes[state.p++]||0);state.lc+=8;}
  state.lc-=nBits;
  return (state.c>>BigInt(state.lc))&((1n<<BigInt(nBits))-1n);
}
export function unpackCodeLengths(bytes,count){
  const state={bytes,p:0,c:0n,lc:0},lengths=[];
  for(let i=0;i<count;){
    const length=Number(getBits(6,state));
    if(length===LONG_ZEROCODE_RUN){let run=Number(getBits(8,state))+SHORTEST_LONG_RUN;while(run--)lengths[i++]=0;}
    else if(length>=SHORT_ZEROCODE_RUN){let run=length-SHORT_ZEROCODE_RUN+2;while(run--)lengths[i++]=0;}
    else lengths[i++]=length;
  }
  return {lengths,read:state.p};
}
export function hufDecompress(bytes,count){
  if(bytes.length<20)throw Error('corrupt huffman header');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),im=view.getUint32(0,true),iM=view.getUint32(4,true),nBits=view.getUint32(12,true);
  if(im>=HUF_ENCSIZE||iM>=HUF_ENCSIZE||im>iM)throw Error('corrupt huffman header');
  const table=unpackCodeLengths(bytes.subarray(20),iM-im+1),lengths=Array(iM+1).fill(0);
  table.lengths.forEach((length,index)=>{lengths[im+index]=length;});
  return hufDecode(canonical(lengths),bytes.subarray(20+table.read),nBits,iM,count);
}
function buildDecoder(codes){
  const table=Array.from({length:HUF_DECSIZE},()=>({len:0,lit:0,p:null}));
  codes.forEach((packed,symbol)=>{
    const code=codeOf(packed),length=lenOf(packed);
    if(!length)return;
    if(code>>BigInt(length))throw Error('corrupt huffman code');
    if(length>HUF_DECBITS){
      const slot=table[Number(code>>BigInt(length-HUF_DECBITS))];
      if(slot.len)throw Error('corrupt huffman table');
      slot.lit++;slot.p=slot.p?[...slot.p,symbol]:[symbol];
    }else{
      let index=Number(code<<BigInt(HUF_DECBITS-length));
      for(let n=1<<(HUF_DECBITS-length);n>0;n--,index++){
        if(table[index].len||table[index].p)throw Error('corrupt huffman table');
        table[index].len=length;table[index].lit=symbol;
      }
    }
  });
  return table;
}
function pullByte(state){state.c=(state.c<<8n)|BigInt(state.bytes[state.p++]);state.lc+=8;}
function emit(symbol,rlc,state,out,index){
  if(symbol===rlc){
    if(state.lc<8){if(state.p>=state.end)throw Error('corrupt huffman run');pullByte(state);}
    state.lc-=8;let count=Number((state.c>>BigInt(state.lc))&255n);
    if(index<1||index+count>out.length)throw Error('corrupt huffman run');
    const previous=out[index-1];while(count-- > 0)out[index++]=previous;return index;
  }
  if(index>=out.length)throw Error('corrupt huffman output');
  out[index++]=symbol;return index;
}
export function hufDecode(codes,bytes,bitCount,rlc,count){
  const table=buildDecoder(codes),out=new Uint16Array(count);
  const state={bytes,p:0,end:Math.ceil(bitCount/8),c:0n,lc:0};
  let index=0;
  while(state.p<state.end){
    pullByte(state);
    while(state.lc>=HUF_DECBITS){
      const slot=table[Number((state.c>>BigInt(state.lc-HUF_DECBITS))&BigInt(HUF_DECMASK))];
      if(slot.len){if(slot.len>state.lc)throw Error('corrupt huffman code');state.lc-=slot.len;index=emit(slot.lit,rlc,state,out,index);}
      else{if(!slot.p)throw Error('corrupt huffman code');let found=false;for(const symbol of slot.p){const length=lenOf(codes[symbol]);while(state.lc<length&&state.p<state.end)pullByte(state);if(state.lc>=length&&codeOf(codes[symbol])===((state.c>>BigInt(state.lc-length))&((1n<<BigInt(length))-1n))){state.lc-=length;index=emit(symbol,rlc,state,out,index);found=true;break;}}if(!found)throw Error('corrupt huffman code');}
    }
  }
  const skip=(8-bitCount)&7;state.c>>=BigInt(skip);state.lc-=skip;
  while(state.lc>0){
    const slot=table[Number((state.c<<BigInt(HUF_DECBITS-state.lc))&BigInt(HUF_DECMASK))];
    if(!slot.len||slot.len>state.lc)throw Error('corrupt huffman tail');
    state.lc-=slot.len;index=emit(slot.lit,rlc,state,out,index);
  }
  if(index!==count)throw Error('huffman output length '+index);
  return out;
}
export function hufRoundTrip(symbols,lengths,rlc){
  const codes=canonical(lengths),packed=packCodeLengths(lengths),back=unpackCodeLengths(packed,lengths.length);
  if(back.lengths.some((length,index)=>length!==lengths[index]))throw Error('table');
  const state={c:0n,lc:0,out:[]};let bits=0;
  for(const symbol of symbols){const length=lenOf(codes[symbol]);outputBits(length,codeOf(codes[symbol]),state);bits+=length;}
  flushBits(state);
  const header=new Uint8Array(20),view=new DataView(header.buffer);
  view.setUint32(4,lengths.length-1,true);view.setUint32(12,bits,true);
  const file=new Uint8Array(header.length+packed.length+state.out.length);
  file.set(header);file.set(packed,20);file.set(state.out,20+packed.length);
  return hufDecompress(file,symbols.length);
}
function heapGreater(freq,a,b){return freq[a]>freq[b]||(freq[a]===freq[b]&&a>b);}
function internPush(heap,hole,top,value,freq){let parent=(hole-1)>>1;while(hole>top&&heapGreater(freq,heap[parent],value)){heap[hole]=heap[parent];hole=parent;parent=(hole-1)>>1;}heap[hole]=value;}
function adjustHeap(heap,hole,len,value,freq){
  const top=hole;let second=hole;
  while(second<((len-1)>>1)){second=2*(second+1);if(heapGreater(freq,heap[second],heap[second-1]))second--;heap[hole]=heap[second];hole=second;}
  if((len&1)===0&&second===((len-2)>>1)){second=2*(second+1);heap[hole]=heap[second-1];hole=second-1;}
  internPush(heap,hole,top,value,freq);
}
function makeHeap(heap,freq){const len=heap.length;if(len<2)return;for(let parent=(len-2)>>1;;parent--){adjustHeap(heap,parent,len,heap[parent],freq);if(parent===0)return;}}
function popHeap(heap,freq){if(heap.length<=1)return;const last=heap.length-1,value=heap[last];heap[last]=heap[0];adjustHeap(heap,0,last,value,freq);}
function pushHeap(heap,freq){internPush(heap,heap.length-1,0,heap[heap.length-1],freq);}
function hufBuild(raw){
  const freq=Array(HUF_ENCSIZE).fill(0);for(const value of raw)freq[value]++;
  let im=0;while(!freq[im])im++;
  const hlink=new Uint32Array(HUF_ENCSIZE),heap=[];let iM=0;
  for(let i=im;i<HUF_ENCSIZE;i++){hlink[i]=i;if(freq[i]){heap.push(i);iM=i;}}
  iM++;freq[iM]=1;heap.push(iM);makeHeap(heap,freq);
  const scode=Array(HUF_ENCSIZE).fill(0);
  while(heap.length>1){
    const mm=heap[0];popHeap(heap,freq);heap.pop();
    const m=heap[0];popHeap(heap,freq);freq[m]+=freq[mm];pushHeap(heap,freq);
    for(let j=m;;j=hlink[j]){scode[j]++;if(hlink[j]===j){hlink[j]=mm;break;}}
    for(let j=mm;;j=hlink[j]){scode[j]++;if(hlink[j]===j)break;}
  }
  return {codes:canonical(scode),im,iM};
}
function sendCode(symbolCode,runCount,runCode,state){
  const symbolLength=lenOf(symbolCode),runLength=lenOf(runCode);
  if(symbolLength+runLength+8<symbolLength*runCount){outputBits(symbolLength,codeOf(symbolCode),state);outputBits(runLength,codeOf(runCode),state);outputBits(8,runCount,state);}
  else while(runCount-->=0)outputBits(symbolLength,codeOf(symbolCode),state);
}
function hufEncode(codes,raw,rlc){
  const state={c:0n,lc:0,out:[]};let symbol=raw[0],run=0;
  for(let i=1;i<raw.length;i++){if(symbol===raw[i]&&run<255)run++;else{sendCode(codes[symbol],run,codes[rlc],state);run=0;}symbol=raw[i];}
  sendCode(codes[symbol],run,codes[rlc],state);
  const bits=state.out.length*8+state.lc;flushBits(state);return {bytes:Uint8Array.from(state.out),bits};
}
export function hufCompress(raw){
  if(!raw.length)return new Uint8Array();
  const built=hufBuild(raw),lengths=[];
  for(let i=built.im;i<=built.iM;i++)lengths.push(lenOf(built.codes[i]||0n));
  const table=packCodeLengths(lengths),data=hufEncode(built.codes,raw,built.iM),out=new Uint8Array(20+table.length+data.bytes.length),view=new DataView(out.buffer);
  view.setUint32(0,built.im,true);view.setUint32(4,built.iM,true);view.setUint32(8,table.length,true);view.setUint32(12,data.bits,true);
  out.set(table,20);out.set(data.bytes,20+table.length);return out;
}
