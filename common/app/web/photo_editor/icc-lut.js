import {validateProfile} from './psd-profile.js';
import {convertMatrixRgbToSrgb,xyzConnection} from './icc-rgb.js';

const MAX_CLUT=16*1024*1024,XYZ_SCALE=65535/32768,V2_L=100*65535/65280,V2_AB=255*65535/65280,D50=[.9642,1,.8249];
const srgbMatrix=[[3.133856,-1.616867,-.490615],[-.978768,1.916142,.033454],[.071945,-.228991,1.405243]];
const encodeSrgb=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
const sig=offset=>bytes=>String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);

function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function u8(bytes,offset){if(offset<0||offset>=bytes.length)throw Error('Truncated ICC tag.');return bytes[offset];}
function u16(bytes,offset){if(offset<0||offset+2>bytes.length)throw Error('Truncated ICC tag.');return viewOf(bytes).getUint16(offset);}
function u32(bytes,offset){if(offset<0||offset+4>bytes.length)throw Error('Truncated ICC tag.');return viewOf(bytes).getUint32(offset);}
function s15(bytes,offset){return viewOf(bytes).getInt32(offset)/65536;}
function tableCurve(samples){return x=>{const n=samples.length;if(n<2)return n?samples[0]:x;const pos=Math.max(0,Math.min(1,x))*(n-1),i=Math.min(n-2,pos|0);return samples[i]+(samples[i+1]-samples[i])*(pos-i);};}
function curveFrom(bytes,offset){
  const type=sig(offset)(bytes);
  if(type==='curv'){const n=u32(bytes,offset+8);if(n>1048576)throw Error('ICC curve is too long.');const len=12+n*2;if(!n)return {eval:x=>x,length:len};if(n===1){const gamma=u16(bytes,offset+12)/256;return {eval:x=>x<=0?0:x**gamma,length:len};}const samples=Float32Array.from({length:n},(_,i)=>u16(bytes,offset+12+i*2)/65535);return {eval:tableCurve(samples),length:len};}
  if(type!=='para')throw Error('Unsupported ICC curve type.');
  const kind=u16(bytes,offset+8),count=[1,3,4,5,7][kind];if(!count)throw Error('Unsupported ICC parametric curve.');
  const p=Array(7).fill(0);for(let i=0;i<count;i++)p[i]=s15(bytes,offset+12+i*4);
  const [g,a,b,c,d,e,f]=p,power=v=>v<=0?0:v**g;
  const evalCurve=x=>kind===0?(x<0?-power(-x):power(x)):kind===1?(a!==0&&x>=-b/a?power(a*x+b):0):kind===2?(a!==0&&x>=-b/a?power(a*x+b)+c:c):kind===3?(x>=d?power(a*x+b):c*x):(x>=d?power(a*x+b)+e:c*x+f);
  return {eval:x=>evalCurve(x),length:12+count*4};
}
function curvesAt(bytes,offset,count){const curves=[];let at=offset;for(let i=0;i<count;i++){const curve=curveFrom(bytes,at);curves.push(curve.eval);at+=(curve.length+3)&~3;}return curves;}
function readSamples(bytes,offset,count,wide){const samples=new Float32Array(count);if(wide){for(let i=0;i<count;i++)samples[i]=u16(bytes,offset+i*2)/65535;}else for(let i=0;i<count;i++)samples[i]=bytes[offset+i]/255;return samples;}

export function clutEval(grid,outputs,data,input){
  const inputs=grid.length,strides=Array(inputs);let stride=outputs;
  for(let i=inputs-1;i>=0;i--){strides[i]=stride;stride*=Math.max(1,grid[i]);}
  const locate=(d,v)=>{const n=grid[d];if(n<2)return [0,0,0];const p=Math.max(0,Math.min(1,v))*(n-1),i=Math.min(n-2,p|0);return [i*strides[d],p-i,strides[d]];};
  const out=new Float32Array(outputs);
  if(inputs===1){const [b,r,s]=locate(0,input[0]);for(let k=0;k<outputs;k++){const a=data[b+k],c=s?data[b+s+k]:a;out[k]=a+(c-a)*r;}return out;}
  const tetra=(base,s,r)=>{const [rx,ry,rz]=r,[sx,sy,sz]=s,c000=base,c100=base+sx,c010=base+sy,c001=base+sz,c110=base+sx+sy,c101=base+sx+sz,c011=base+sy+sz,c111=base+sx+sy+sz;
    let p1,p2,p3,w1,w2,w3;if(rx>=ry){if(ry>=rz){p1=c100;p2=c110;p3=c111;w1=rx;w2=ry;w3=rz;}else if(rx>=rz){p1=c100;p2=c101;p3=c111;w1=rx;w2=rz;w3=ry;}else{p1=c001;p2=c101;p3=c111;w1=rz;w2=rx;w3=ry;}}
    else if(rx>=rz){p1=c010;p2=c110;p3=c111;w1=ry;w2=rx;w3=rz;}else if(ry>=rz){p1=c010;p2=c011;p3=c111;w1=ry;w2=rz;w3=rx;}else{p1=c001;p2=c011;p3=c111;w1=rz;w2=ry;w3=rx;}
    const values=new Float32Array(outputs);for(let k=0;k<outputs;k++){const v0=data[c000+k],v1=data[p1+k],v2=data[p2+k],v3=data[p3+k];values[k]=v0+(v1-v0)*w1+(v2-v1)*w2+(v3-v2)*w3;}return values;};
  if(inputs===3){const [b0,r0,s0]=locate(0,input[0]),[b1,r1,s1]=locate(1,input[1]),[b2,r2,s2]=locate(2,input[2]);return tetra(b0+b1+b2,[s0,s1,s2],[r0,r1,r2]);}
  if(inputs===4){const [b0,r0,s0]=locate(0,input[0]),[b1,r1,s1]=locate(1,input[1]),[b2,r2,s2]=locate(2,input[2]),[b3,r3,s3]=locate(3,input[3]),base=b0+b1+b2+b3,lo=tetra(base,[s1,s2,s3],[r1,r2,r3]);if(!(r0>0&&s0))return lo;const hi=tetra(base+s0,[s1,s2,s3],[r1,r2,r3]);for(let k=0;k<outputs;k++)out[k]=lo[k]+(hi[k]-lo[k])*r0;return out;}
  const bases=[],fractions=[],steps=[];let base=0;for(let d=0;d<inputs;d++){const [b,r,s]=locate(d,input[d]);base+=b;fractions[d]=r;steps[d]=s;}
  for(let corner=0;corner<(1<<inputs);corner++){let weight=1,off=base;for(let d=0;d<inputs;d++){if(corner&(1<<d)){weight*=fractions[d];off+=steps[d];}else weight*=1-fractions[d];}if(!weight)continue;for(let k=0;k<outputs;k++)out[k]+=weight*data[off+k];}
  return out;
}

function parseMft(bytes,a2b){
  const wide=sig(0)(bytes)==='mft2',inputs=u8(bytes,8),outputs=u8(bytes,9),gridPoints=u8(bytes,10);
  if(inputs<1||inputs>15||outputs<1||outputs>15||!gridPoints)throw Error('Invalid ICC LUT dimensions.');
  const matrix=[];for(let i=0;i<9;i++)matrix.push(s15(bytes,12+i*4));
  const entryCount=wide?u16(bytes,48):256,exitCount=wide?u16(bytes,50):256;let offset=wide?52:48;
  if(wide&&(entryCount<2||entryCount>4096||exitCount<2||exitCount>4096))throw Error('Invalid ICC lut16 table size.');
  const tables=(count,length)=>{const curves=[];for(let i=0;i<count;i++){curves.push(tableCurve(readSamples(bytes,offset,length,wide)));offset+=length*(wide?2:1);}return curves;};
  const inputCurves=tables(inputs,entryCount),nodes=gridPoints**inputs;
  if(nodes*outputs>MAX_CLUT)throw Error('ICC CLUT is too large.');
  const data=readSamples(bytes,offset,nodes*outputs,wide);offset+=nodes*outputs*(wide?2:1);
  const outputCurves=tables(outputs,exitCount),stages=[];
  const identity=matrix.every((value,index)=>Math.abs(value-(index%4===0?1:0))<1e-6);
  if(!a2b&&inputs===3&&!identity)stages.push({matrix,offset:[0,0,0]});
  stages.push({curves:inputCurves},{clut:{grid:Array(inputs).fill(gridPoints),outputs,data}},{curves:outputCurves});
  return {kind:wide?'lut16':'lut8',inputs,outputs,stages};
}
function parseMab(bytes){
  const type=sig(0)(bytes),inputs=u8(bytes,8),outputs=u8(bytes,9);
  if(inputs<1||inputs>15||outputs<1||outputs>15)throw Error('Invalid ICC lutAToB dimensions.');
  const bOffset=u32(bytes,12),mOffset=u32(bytes,16),mCurves=u32(bytes,20),clutOffset=u32(bytes,24),aOffset=u32(bytes,28),stages=[];
  const matrixStage=off=>{const m=Array.from({length:9},(_,i)=>s15(bytes,off+i*4));return {matrix:m,offset:[s15(bytes,off+36),s15(bytes,off+40),s15(bytes,off+44)]};};
  const clutStage=(off,cin,cout)=>{const grid=[];for(let i=0;i<cin;i++){const g=u8(bytes,off+i);if(g<1)throw Error('ICC CLUT has a zero grid.');grid.push(g);}const precision=u8(bytes,off+16);if(precision!==1&&precision!==2)throw Error('Invalid ICC CLUT precision.');const nodes=grid.reduce((p,g)=>p*g,1);if(nodes*cout>MAX_CLUT)throw Error('ICC CLUT is too large.');return {clut:{grid,outputs:cout,data:readSamples(bytes,off+20,nodes*cout,precision===2)}};};
  if(type==='mAB '){
    if(clutOffset){if(!aOffset)throw Error('ICC lutAToB has a CLUT without A curves.');stages.push({curves:curvesAt(bytes,aOffset,inputs)},clutStage(clutOffset,inputs,outputs));}
    else if(inputs!==outputs)throw Error('ICC lutAToB without a CLUT changes the channel count.');
    if(mOffset)stages.push({curves:curvesAt(bytes,mCurves,outputs)},matrixStage(mOffset));
    if(!bOffset)throw Error('ICC lutAToB has no B curves.');
    stages.push({curves:curvesAt(bytes,bOffset,outputs)});
  }else{
    if(!bOffset)throw Error('ICC lutBToA has no B curves.');
    stages.push({curves:curvesAt(bytes,bOffset,inputs)});
    if(mOffset)stages.push(matrixStage(mOffset),{curves:curvesAt(bytes,mCurves,inputs)});
    if(clutOffset){if(!aOffset)throw Error('ICC lutBToA has a CLUT without A curves.');stages.push(clutStage(clutOffset,inputs,outputs),{curves:curvesAt(bytes,aOffset,outputs)});}
    else if(inputs!==outputs)throw Error('ICC lutBToA without a CLUT changes the channel count.');
  }
  return {kind:'ab',inputs,outputs,stages};
}
export function parseLutTag(bytes,a2b){const type=sig(0)(bytes);if(type==='mft1'||type==='mft2')return parseMft(bytes,a2b);if(type==='mAB '||type==='mBA ')return parseMab(bytes);throw Error('Unsupported ICC LUT type.');}

function labToXyz(lab){const E=216/24389,K=24389/27,fy=(lab[0]+16)/116,fx=fy+lab[1]/500,fz=fy-lab[2]/200,finv=f=>{const f3=f*f*f;return f3>E?f3:(116*f-16)/K;};return [finv(fx)*D50[0],finv(fy)*D50[1],finv(fz)*D50[2]];}
function xyzToLab(xyz){const E=216/24389,K=24389/27,f=t=>t>E?Math.cbrt(t):(K*t+16)/116,fx=f(Math.max(0,xyz[0])/D50[0]),fy=f(Math.max(0,xyz[1])/D50[1]),fz=f(Math.max(0,xyz[2])/D50[2]);return [116*fy-16,500*(fx-fy),200*(fy-fz)];}
function applyStage(stage,value,pcsKind){
  if(stage.curves)return stage.curves.map((curve,index)=>curve(value[index]||0));
  if(stage.matrix){const cols=stage.matrix.length/stage.offset.length;return stage.offset.map((base,row)=>stage.matrix.slice(row*cols,row*cols+cols).reduce((sum,weight,col)=>sum+weight*(value[col]||0),base));}
  if(stage.clut)return Array.from(clutEval(stage.clut.grid,stage.clut.outputs,stage.clut.data,value));
  if(stage.pcs==='decode-xyz')return value.slice(0,3).map(v=>v*XYZ_SCALE);
  if(stage.pcs==='encode-xyz')return value.slice(0,3).map(v=>Math.max(0,Math.min(1,v/XYZ_SCALE)));
  if(stage.pcs==='decode-lab-v4')return [value[0]*100,value[1]*255-128,value[2]*255-128];
  if(stage.pcs==='encode-lab-v4')return [Math.max(0,Math.min(1,value[0]/100)),Math.max(0,Math.min(1,(value[1]+128)/255)),Math.max(0,Math.min(1,(value[2]+128)/255))];
  if(stage.pcs==='decode-lab-v2')return [value[0]*V2_L,value[1]*V2_AB-128,value[2]*V2_AB-128];
  if(stage.pcs==='encode-lab-v2')return [Math.max(0,Math.min(1,value[0]/V2_L)),Math.max(0,Math.min(1,(value[1]+128)/V2_AB)),Math.max(0,Math.min(1,(value[2]+128)/V2_AB))];
  if(stage.pcs==='lab-xyz')return labToXyz(value);
  if(stage.pcs==='xyz-lab')return xyzToLab(value);
  throw Error('Unknown ICC stage '+pcsKind);
}
export function evalLut(lut,input){return lut.stages.reduce((value,stage)=>applyStage(stage,value),input.slice());}

function tagsOf(bytes){const view=viewOf(bytes),count=view.getUint32(128),tags=new Map();for(let i=0;i<count;i++){const at=132+i*12;tags.set(sig(at)(bytes),bytes.subarray(view.getUint32(at+4),view.getUint32(at+4)+view.getUint32(at+8)));}return tags;}
function profileHead(bytes){
  const tags=tagsOf(bytes),space=sig(16)(bytes),pcs=sig(20)(bytes)==='Lab '?'lab':'xyz',version=bytes[8];
  const whiteTag=tags.get('wtpt');let white=D50.slice();
  if(whiteTag){if(whiteTag.length<20||sig(0)(whiteTag)!=='XYZ ')throw Error('Unsupported ICC media white point.');white=[s15(whiteTag,8),s15(whiteTag,12),s15(whiteTag,16)];}
  const slot=intent=>intent==='perceptual'?0:intent==='saturation'?2:1;
  const named=['A2B0','A2B1','A2B2'];
  const luts=named.map(name=>tags.has(name)?parseLutTag(tags.get(name),true):null);
  return {bytes,tags,space,pcs,version,white,luts,slot};
}
function deviceToPcs(profile,intent){
  const lut=profile.luts[profile.slot(intent)]||profile.luts[0];
  if(!lut)return null;
  const decode=profile.pcs==='xyz'?'decode-xyz':lut.kind==='lut16'?'decode-lab-v2':'decode-lab-v4';
  return {inputs:lut.inputs,outputs:3,stages:[...lut.stages,{pcs:decode}],pcs:profile.pcs};
}
function sourceBlackY(profile,pipeline,intent){
  if(profile.version>=4&&(intent==='perceptual'||intent==='saturation'))return .0034731;
  const zero=evalLut(pipeline,Array(pipeline.inputs).fill(0));
  const y=profile.pcs==='lab'?labToXyz(zero)[1]:zero[1];
  return Math.max(0,Math.min(.5,y));
}
export function convertLutRgbToSrgb(image,profileBytes,options={}){
  const profile=profileHead(validateProfile(profileBytes)),intent=options.intent||'relative';
  if(profile.space!=='RGB ')throw Error('This LUT conversion currently supports RGB profiles.');
  const pipeline=deviceToPcs(profile,intent);if(!pipeline||pipeline.inputs!==3)throw Error('This RGB profile has no 3-channel AToB table.');
  const adjust=xyzConnection(profile.white,sourceBlackY(profile,pipeline,intent),intent,options.bpc!==false);
  for(let i=0;i<image.data.length;i+=4){
    let xyz=evalLut(pipeline,[image.data[i]/255,image.data[i+1]/255,image.data[i+2]/255]);
    if(profile.pcs==='lab')xyz=labToXyz(xyz);
    if(adjust)xyz=xyz.map((value,channel)=>value*adjust.scale[channel]+adjust.offset[channel]);
    for(let c=0;c<3;c++)image.data[i+c]=Math.max(0,Math.min(255,encodeSrgb(srgbMatrix[c].reduce((sum,weight,j)=>sum+weight*xyz[j],0))*255));
  }
  return image;
}
export function convertProfileToSrgb(image,profile,options={}){
  const bytes=validateProfile(profile),tags=tagsOf(bytes);
  if(['A2B0','A2B1','A2B2'].some(name=>tags.has(name)))return convertLutRgbToSrgb(image,bytes,options);
  return convertMatrixRgbToSrgb(image,bytes,options);
}
