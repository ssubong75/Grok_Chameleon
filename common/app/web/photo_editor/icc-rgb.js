import {validateProfile} from './psd-profile.js';
const clamp=v=>Math.max(0,Math.min(1,v));
export function matrixRgbProfile(value){
  const bytes=validateProfile(value),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),signature=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(signature(16)!=='RGB '||signature(20)!=='XYZ ')throw Error('This conversion currently requires an RGB profile with XYZ matrix colorants.');
  const tags=new Map();for(let i=0;i<view.getUint32(128);i++){const p=132+i*12;tags.set(signature(p),{offset:view.getUint32(p+4),length:view.getUint32(p+8)});}
  if(['A2B0','A2B1','A2B2','D2B0','D2B1'].some(key=>tags.has(key)))throw Error('LUT-based ICC profiles require the remaining color-management pipeline.');
  const get=(key,length)=>{const tag=tags.get(key);if(!tag||tag.length<length)throw Error('Missing or truncated ICC '+key+' tag.');return tag;},fixed=p=>view.getInt32(p)/65536;
  const whiteTag=tags.get('wtpt');let white=[0.9642,1,0.8249];
  if(whiteTag){if(whiteTag.length<20||signature(whiteTag.offset)!=='XYZ ')throw Error('Unsupported ICC media white point.');white=[fixed(whiteTag.offset+8),fixed(whiteTag.offset+12),fixed(whiteTag.offset+16)];}
  const columns=['rXYZ','gXYZ','bXYZ'].map(key=>{const t=get(key,20);if(signature(t.offset)!=='XYZ ')throw Error('Unsupported ICC colorant type.');return[fixed(t.offset+8),fixed(t.offset+12),fixed(t.offset+16)];});
  const curves=['rTRC','gTRC','bTRC'].map(key=>{const t=get(key,12),p=t.offset,type=signature(p);if(type==='curv'){const count=view.getUint32(p+8);if(count>1048576||12+count*2>t.length)throw Error('Invalid ICC tone curve.');if(!count)return x=>x;if(count===1){const gamma=view.getUint16(p+12)/256;return x=>x**gamma;}const table=Float64Array.from({length:count},(_,i)=>view.getUint16(p+12+i*2)/65535);return x=>{const pos=clamp(x)*(count-1),i=Math.floor(pos);return table[i]+(table[Math.min(count-1,i+1)]-table[i])*(pos-i);};}
    if(type!=='para')throw Error('Unsupported ICC tone curve type.');const kind=view.getUint16(p+8),n=[1,3,4,5,7][kind];if(!n||12+n*4>t.length)throw Error('Invalid ICC parametric curve.');const params=Array(7).fill(0);for(let i=0;i<n;i++)params[i]=fixed(p+12+i*4);const [g,a,b,c,d,e,f]=params,power=v=>v<=0?0:v**g;return x=>kind===0?x**g:kind===1?(a!==0&&x>=-b/a?power(a*x+b):0):kind===2?(a!==0&&x>=-b/a?power(a*x+b)+c:c):kind===3?(x>=d?power(a*x+b):c*x):(x>=d?power(a*x+b)+e:c*x+f);
  });return{columns,curves,white};
}
const D50=[0.9642,1,0.8249];
// PhotoCraft cms connection(): absolute scales XYZ by the media whites; relative/perceptual/saturation with BPC maps source black onto destination black while white stays fixed.
export function xyzConnection(white,blackY,intent='relative',bpc=true){
  if(intent==='absolute'){
    if(!white.every(value=>Number.isFinite(value)&&value>0))throw Error('Absolute colorimetric needs a positive media white point.');
    const scale=white.map((value,index)=>value/D50[index]);
    return scale.every(value=>Math.abs(value-1)<1e-6)?null:{scale,offset:[0,0,0]};
  }
  if(!['relative','perceptual','saturation'].includes(intent))throw Error('Unknown ICC rendering intent.');
  if(!bpc)return null;
  const source=Math.max(0,Math.min(.5,blackY));
  if(source<1e-6)return null;
  const scale=[0,0,0],offset=[0,0,0];
  for(let index=0;index<3;index++){const from=source*D50[index],gain=(D50[index]-0)/(D50[index]-from);scale[index]=gain;offset[index]=D50[index]*(1-gain);}
  return{scale,offset};
}
const workingSpaces={
  srgb:{gamma:'srgb',toXyz:[[.4124564,.3575761,.1804375],[.2126729,.7151522,.072175],[.0193339,.119192,.9503041]]},
  'display-p3':{gamma:'srgb',toXyz:[[.4865709,.2656677,.1982173],[.2289746,.6917385,.0792869],[0,.0451134,1.0439444]]},
  'adobe-rgb':{gamma:2.2,toXyz:[[.5767309,.185554,.1881852],[.2973769,.6273491,.0752741],[.0270343,.0706872,.9911085]]}
};
const decodeSrgb=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const encodeSrgb=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
function invert3(m){const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)throw Error('The working-space matrix cannot be inverted.');const s=1/det;return [[(e*i-f*h)*s,(c*h-b*i)*s,(b*f-c*e)*s],[(f*g-d*i)*s,(a*i-c*g)*s,(c*d-a*f)*s],[(d*h-e*g)*s,(b*g-a*h)*s,(a*e-b*d)*s]];}
const D65=[0.95047,1,1.08883];
export function convertWorkingRgb(image,from,to,intent='relative',bpc=true){const source=workingSpaces[from]||workingSpaces.srgb,destination=workingSpaces[to]||workingSpaces.srgb;if(source===destination)return image;const toRgb=invert3(destination.toXyz),decode=source.gamma==='srgb'?decodeSrgb:v=>v<=0?0:v**source.gamma,encode=destination.gamma==='srgb'?encodeSrgb:v=>v<=0?0:v**(1/destination.gamma),srcConn=xyzConnection(D65,0,intent,bpc),dstConn=xyzConnection(D65,0,intent,bpc);for(let i=0;i<image.data.length;i+=4){const linear=[0,1,2].map(c=>decode(image.data[i+c]/255));let xyz=[0,1,2].map(row=>source.toXyz[row].reduce((sum,value,channel)=>sum+value*linear[channel],0));if(srcConn)xyz=xyz.map((value,channel)=>value*srcConn.scale[channel]+srcConn.offset[channel]);if(dstConn)xyz=xyz.map((value,channel)=>(value-dstConn.offset[channel])/dstConn.scale[channel]);const rgb=[0,1,2].map(row=>toRgb[row].reduce((sum,value,channel)=>sum+value*xyz[channel],0));for(let c=0;c<3;c++)image.data[i+c]=clamp(encode(rgb[c]))*255;}return image;}
export function convertMatrixRgbToSrgb(image,profile,options={}){const {columns,curves,white}=matrixRgbProfile(profile),intent=options.intent||'relative',bpc=options.bpc!==false,blackY=Math.max(0,Math.min(.5,columns.reduce((sum,column,channel)=>sum+column[1]*curves[channel](0),0))),adjust=xyzConnection(white,blackY,intent,bpc),matrix=[[3.133856,-1.616867,-.490615],[-.978768,1.916142,.033454],[.071945,-.228991,1.405243]],tables=curves.map(curve=>Float64Array.from({length:256},(_,v)=>curve(v/255))),encode=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;for(let i=0;i<image.data.length;i+=4){const linear=[0,1,2].map(c=>tables[c][image.data[i+c]]),xyz=[0,1,2].map(row=>columns.reduce((sum,column,c)=>sum+column[row]*linear[c],0));if(adjust)for(let c=0;c<3;c++)xyz[c]=xyz[c]*adjust.scale[c]+adjust.offset[c];for(let c=0;c<3;c++)image.data[i+c]=clamp(encode(matrix[c].reduce((sum,v,j)=>sum+v*xyz[j],0)))*255;}return image;}
