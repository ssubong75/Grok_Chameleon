import {customBlends,compositeCustom} from './blend-modes.js';
// PhotoCraft compose/psblend.rs composite_gamma/text_encode/text_decode.
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
let textGammaSetting=1.45;
export function getTextGamma(){return textGammaSetting;}
export function setTextGamma(value){if(!Number.isFinite(value)||value<1||value>2.2)throw Error('Text blending gamma must be between1.00 and2.20.');textGammaSetting=value;}
export function compositeTextGamma(destination,source,mode='source-over',opacity=1,gamma=textGammaSetting){
  if(gamma===1){if(customBlends.has(mode))compositeCustom(destination,source,mode,opacity);else{const context=destination.getContext('2d');context.save();context.globalAlpha=opacity;context.globalCompositeOperation=mode;context.drawImage(source,0,0);context.restore();}return;}
  const width=destination.width,height=destination.height,context=destination.getContext('2d'),back=context.getImageData(0,0,width,height),front=source.getContext('2d').getImageData(0,0,width,height),make=()=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;},opaqueBack=make(),opaqueFront=make(),b=new ImageData(new Uint8ClampedArray(back.data),width,height),f=new ImageData(new Uint8ClampedArray(front.data),width,height);
  for(let i=3;i<b.data.length;i+=4)b.data[i]=f.data[i]=255;opaqueBack.getContext('2d').putImageData(b,0,0);opaqueFront.getContext('2d').putImageData(f,0,0);
  if(customBlends.has(mode))compositeCustom(opaqueBack,opaqueFront,mode,1);else{const paint=opaqueBack.getContext('2d');paint.globalCompositeOperation=mode;paint.drawImage(opaqueFront,0,0);}
  const blended=opaqueBack.getContext('2d').getImageData(0,0,width,height).data,encode=v=>linear(Math.max(0,v))**(1/gamma),decode=v=>srgb(Math.max(0,v)**gamma);
  for(let i=0;i<back.data.length;i+=4){const ab=back.data[i+3]/255,as=front.data[i+3]/255*opacity;if(as<=0)continue;const alpha=as+ab*(1-as);if(alpha<=0){back.data.fill(0,i,i+4);continue;}const wb=(1-as)*ab/alpha,ws=(1-ab)*as/alpha,wbs=as*ab/alpha;for(let c=0;c<3;c++)back.data[i+c]=decode(wb*encode(back.data[i+c]/255)+ws*encode(front.data[i+c]/255)+wbs*encode(blended[i+c]/255))*255;back.data[i+3]=alpha*255;}
  context.putImageData(back,0,0);
}
