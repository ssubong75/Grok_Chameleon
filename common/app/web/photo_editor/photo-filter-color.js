import {labToSrgb} from './lab-color.js';
const clamp=v=>Math.max(0,Math.min(1,v));
// Source io/adjust_map.rs parse_photo_filter version-3 white-relative XYZ.
export function relativeXyzColor(xyz){
  if(!Array.isArray(xyz)||xyz.length!==3||xyz.some(v=>!Number.isFinite(v)||v<0||v>2))return null;
  const p=[xyz[0]*.96422,xyz[1],xyz[2]*.82521],matrix=[[3.133856,-1.616867,-.490615],[-.978768,1.916142,.033454],[.071945,-.228991,1.405243]];
  return matrix.map(row=>{const v=clamp(row.reduce((n,k,i)=>n+k*p[i],0));return v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;});
}
export function photoFilterColor(color){
  if(!color)return null;
  if(['r','g','b'].every(key=>Number.isFinite(color[key])))return[color.r,color.g,color.b].map(v=>clamp(v/255));
  if(color.xyz)return relativeXyzColor(color.xyz);
  if(['l','a','b'].every(key=>Number.isFinite(color[key])))return labToSrgb(color.l*100,color.a*(color.a<0?128:127),color.b*(color.b<0?128:127));
  if(Number.isFinite(color.k)&&color.c==null)return Array(3).fill(clamp(color.k/255));
  return null;
}
export const colorHex=rgb=>'#'+rgb.map(v=>Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join('');
export function retainedPhotoColor(amount){
  const rgb=amount?.colorRgb;return Array.isArray(rgb)&&rgb.length===3&&rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&colorHex(rgb)===amount.color?rgb:null;
}
