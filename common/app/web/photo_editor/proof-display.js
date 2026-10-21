// PhotoCraft proof_sim display simulations. Profile proofs round-trip the editor CMYK separation.
// Gamut Warning is GamutCheck: sRGB to Lab against sRGB to coated CMYK to Lab, relative, no black-point compensation.
import {cachedProfile} from './cms-profiles.js';
import {convertSamples} from './cms-convert.js';
export const GAMUT_THRESHOLD=4;
export function gamutMask(rgb,threshold=GAMUT_THRESHOLD){
  const src=cachedProfile('srgb'),proof=cachedProfile('coated-cmyk'),lab=cachedProfile('lab-d50');
  const direct=convertSamples(src,lab,rgb,'relative',false),ink=convertSamples(src,proof,rgb,'relative',false),via=convertSamples(proof,lab,ink,'relative',false);
  const mask=new Uint8Array(rgb.length/3);let count=0;
  for(let i=0,j=0;i<mask.length;i++,j+=3){const delta=Math.hypot((direct[j]-via[j])*100,(direct[j+1]-via[j+1])*255,(direct[j+2]-via[j+2])*255);if(delta>threshold){mask[i]=255;count++;}}
  return {mask,count};
}
const RGB_LMS=[[17.8824,43.5161,4.11935],[3.45565,27.1554,3.86714],[0.0299566,0.184309,1.46709]];
const LMS_RGB=[[0.08094445,-0.13050441,0.11672107],[-0.010248533,0.054019327,-0.11361471],[-0.000365297,-0.0041216147,0.6935114]];
const mul=(m,v)=>[0,1,2].map(i=>m[i][0]*v[0]+m[i][1]*v[1]+m[i][2]*v[2]);
const srgbToLinear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
const linearToSrgb=v=>{const x=Math.max(0,Math.min(1,v));return x<=0.0031308?x*12.92:1.055*x**(1/2.4)-0.055;};
export function dichromat(rgb,protan){const v=rgb.map(c=>0.992052*c+0.003974);const lms=mul(RGB_LMS,v);const next=protan?[2.02344*lms[1]-2.52581*lms[2],lms[1],lms[2]]:[lms[0],0.494207*lms[0]+1.24827*lms[2],lms[2]];return mul(LMS_RGB,next).map(c=>Math.max(0,Math.min(1,c)));}
export function macintoshRgb(rgb){return rgb.map(channel=>linearToSrgb(Math.max(0,channel)**1.8));}
export function plateInk(ink,kind){if(kind==='workingCyanPlate')return [0,0,0,ink[0]];if(kind==='workingMagentaPlate')return [0,0,0,ink[1]];if(kind==='workingYellowPlate')return [0,0,0,ink[2]];if(kind==='workingBlackPlate')return [0,0,0,ink[3]];return [ink[0],ink[1],ink[2],0];}
export function plateGray(ink){const g=1-Math.max(0,Math.min(1,ink[3]));return [g,g,g];}
export function proofPixel(rgb,kind,doc,rgbToCmyk,cmykToRgb){
  if(kind==='colorBlindnessProtanopia'||kind==='colorBlindnessDeuteranopia')return dichromat(rgb.map(srgbToLinear),kind==='colorBlindnessProtanopia').map(linearToSrgb);
  if(kind==='legacyMacintoshRgb')return macintoshRgb(rgb);
  if(kind==='internetStandardRgb'||kind==='monitorRgb')return rgb;
  if(!rgbToCmyk||!cmykToRgb)return rgb;
  const ink=rgbToCmyk(doc,rgb);
  if(kind==='workingCmyPlate')return cmykToRgb(doc,plateInk(ink,kind));
  if(kind.endsWith('Plate'))return plateGray(plateInk(ink,kind));
  return cmykToRgb(doc,ink);
}
