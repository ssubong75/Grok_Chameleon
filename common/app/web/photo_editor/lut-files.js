import {parseCube} from './color-lookup.js';
// PhotoCraft cms/lutfile.rs: red-fastest normalized 3DL/LOOK tables and generated CC0 looks.
const clamp=v=>Math.max(0,Math.min(1,v));
function checked(size,values,title=''){if(!Number.isInteger(size)||size<2||size>129||values.length!==size**3*3||!values.every(Number.isFinite))throw Error('Invalid LUT size or values.');return{size,values:Float32Array.from(values),title};}
export function parseLutFile(name,text){
  if(typeof text!=='string'||text.length>200000000)throw Error('Invalid LUT data.');
  if(/\.3dl$/i.test(name)){
    const rows=[];let max=0;for(let line of text.split(/\r?\n/)){line=line.split('#')[0].trim();if(!line||/^[a-z]/i.test(line))continue;const values=line.split(/\s+/).map(Number).filter(Number.isFinite);if(values.length===3){rows.push(values);for(const value of values)max=Math.max(max,value);}if(rows.length>129**3)throw Error('The LUT exceeds size 129.');}
    const size=Math.round(Math.cbrt(rows.length));if(size<2||size>129||size**3!==rows.length)throw Error('The 3DL rows do not form a cube.');const scale=max<=1?1:[1023,4095,16383,65535].find(v=>max<=v)||max,values=new Float32Array(rows.length*3);
    for(let i=0;i<rows.length;i++){const r=Math.floor(i/(size*size)),g=Math.floor(i/size)%size,b=i%size,index=((b*size+g)*size+r)*3;for(let c=0;c<3;c++)values[index+c]=rows[i][c]/scale;}return checked(size,values);
  }
  if(/\.look$/i.test(name)||text.trimStart().startsWith('<')){
    const tag=key=>{const start=text.indexOf('<'+key+'>');if(start<0)return null;const at=start+key.length+2,end=text.indexOf('</'+key+'>',at);return end<0?null:text.slice(at,end).trim().replace(/^"|"$/g,'').trim();};
    const size=Number(tag('size'));if(!Number.isInteger(size)||size<2||size>129)throw Error('Invalid LOOK size.');const hex=(tag('data')||'').replace(/[^0-9a-f]/gi,''),floats=Math.floor(hex.length/8);if(floats!==size**3*3&&floats!==size**3*4)throw Error('LOOK sample count does not match its size.');const bytes=new Uint8Array(Math.floor(hex.length/2));for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);const view=new DataView(bytes.buffer),count=Math.floor(bytes.length/4),rgba=count===size**3*4,values=[];for(let i=0;i<count;i++)if(!rgba||i%4!==3)values.push(view.getFloat32(i*4,true));return checked(size,values,tag('title')||'');
  }
  return parseCube(text);
}
export function writeCube(table){const lines=['TITLE "'+String(table.title||'Custom').replaceAll('"',"'")+'"','LUT_3D_SIZE '+table.size];for(let i=0;i<table.values.length;i+=3)lines.push(Array.from(table.values.subarray(i,i+3),v=>v.toFixed(6)).join(' '));return lines.join('\n')+'\n';}
export const builtinLooks=[['warm','Warm Filter'],['cool','Cool Filter'],['tealOrange','Teal & Orange'],['bleachBypass','Bleach Bypass'],['fadedFilm','Faded Film'],['dayForNight','Day for Night'],['monoContrast','Mono High Contrast'],['crossProcess','Cross Process']];
export function builtinLut(id){
  const title=builtinLooks.find(item=>item[0]===id)?.[1];if(!title)throw Error('Unknown LUT look.');const size=33,values=new Float32Array(size**3*3),smooth=v=>{v=clamp(v);return v*v*(3-2*v);};let at=0;
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++){
    const c=[r/32,g/32,b/32],l=.299*c[0]+.587*c[1]+.114*c[2];let out;
    if(id==='warm')out=[c[0]*.92+.08,c[1]*.97+.02,c[2]*.85];else if(id==='cool')out=[c[0]*.86,c[1]*.97+.01,c[2]*.9+.1];
    else if(id==='tealOrange'){const t=smooth(l);out=c.map((v,k)=>{const tint=[0,.5,.55][k]*(1-t)+[1,.62,.3][k]*t;return v*.75+Math.min(1,tint*l*1.1)*.25+(smooth(v)-v)*.3;});}
    else if(id==='bleachBypass')out=c.map(v=>(v*.45+l*.55)*.5+smooth(l)*.5);
    else if(id==='fadedFilm')out=c.map((v,k)=>(.08+(v*.8+l*.2)*.84)*[1,.96,.88][k]+.02);
    else if(id==='dayForNight')out=[l*.35,l*.45+c[1]*.05,l*.65+c[2]*.15];else if(id==='monoContrast')out=Array(3).fill(smooth(smooth(l)));else out=[smooth(c[0])*1.05,c[1]*1.1-.03,c[2]*.7+.15];
    for(const v of out)values[at++]=clamp(v);
  }return{size,values,title};
}
