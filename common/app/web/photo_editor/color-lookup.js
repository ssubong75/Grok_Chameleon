// PhotoCraft cms/lutfile.rs parse_cube and compose/adjust.rs lut3d_sample.
const clamp=v=>Math.max(0,Math.min(1,v));
export const identityCube='LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
export function parseCube(text){
  if(typeof text!=='string'||text.length>200000000)throw Error('Invalid Cube LUT data.');
  let size3=0,size1=0,title='',min=[0,0,0],max=[1,1,1];const rows=[];
  const triple=items=>{const values=items.map(Number);if(values.length!==3||!values.every(Number.isFinite))throw Error('A Cube row needs three finite values.');return values;};
  for(let line of text.split(/\r?\n/)){line=line.split('#')[0].trim();if(!line)continue;const [key,...items]=line.split(/\s+/);
    if(key==='TITLE')title=line.slice(5).trim().replace(/^"|"$/g,'');
    else if(key==='LUT_3D_SIZE')size3=Number(items[0]);else if(key==='LUT_1D_SIZE')size1=Number(items[0]);
    else if(key==='DOMAIN_MIN')min=triple(items);else if(key==='DOMAIN_MAX')max=triple(items);
    else if(key==='LUT_3D_INPUT_RANGE'||key==='LUT_1D_INPUT_RANGE'){if(items.length===2){min=Array(3).fill(Number(items[0]));max=Array(3).fill(Number(items[1]));}}
    else if(/^[\d+.-]/.test(key)){rows.push(...triple([key,...items]));if(rows.length>129**3*3)throw Error('The Cube LUT exceeds size 129.');}
  }
  if(min.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(max[i])||v>=max[i]))throw Error('Cube DOMAIN_MIN must be below DOMAIN_MAX.');
  if(size3){if(!Number.isInteger(size3)||size3<2||size3>129||rows.length!==size3**3*3)throw Error('Cube size or sample count is invalid.');if(min.some(v=>v!==0)||max.some(v=>v!==1))throw Error('Custom 3D Cube input domains are not supported.');return{size:size3,values:Float32Array.from(rows),title};}
  if(!Number.isInteger(size1)||size1<2||rows.length!==size1*3)throw Error('No valid LUT_3D_SIZE or LUT_1D_SIZE was found.');
  const size=33,values=new Float32Array(size**3*3);let i=0;
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++)for(let c=0;c<3;c++){const p=clamp(([r,g,b][c]/32-min[c])/(max[c]-min[c]))*(size1-1),j=Math.min(size1-2,Math.floor(p)),f=p-j;values[i++]=clamp(rows[j*3+c]*(1-f)+rows[(j+1)*3+c]*f);}
  return{size,values,title};
}
export function lookupSettings(amount={}){
  const data=amount.data||identityCube;if(typeof data!=='string')throw Error('Invalid LUT file data.');const interpolation=amount.interpolation||'trilinear';if(!['trilinear','tetrahedral'].includes(interpolation))throw Error('Choose Trilinear or Tetrahedral.');return{data,fileName:String(amount.fileName||'Identity.cube'),interpolation,dither:Boolean(amount.dither)};
}
function sample(table,color,tetrahedral){
  const n=table.size,m=n-1,p=color.map(v=>clamp(v)*m),base=p.map(v=>Math.min(n-2,Math.floor(v))),f=p.map((v,i)=>v-base[i]),at=(r,g,b)=>{const i=(((base[2]+b)*n+base[1]+g)*n+base[0]+r)*3;return[table.values[i],table.values[i+1],table.values[i+2]];},[r,g,b]=f;
  if(tetrahedral){let vertices,weights;
    if(r>g){if(g>b){vertices=[[0,0,0],[1,0,0],[1,1,0],[1,1,1]];weights=[1-r,r-g,g-b,b];}else if(r>b){vertices=[[0,0,0],[1,0,0],[1,0,1],[1,1,1]];weights=[1-r,r-b,b-g,g];}else{vertices=[[0,0,0],[0,0,1],[1,0,1],[1,1,1]];weights=[1-b,b-r,r-g,g];}}
    else if(b>g){vertices=[[0,0,0],[0,0,1],[0,1,1],[1,1,1]];weights=[1-b,b-g,g-r,r];}else if(b>r){vertices=[[0,0,0],[0,1,0],[0,1,1],[1,1,1]];weights=[1-g,g-b,b-r,r];}else{vertices=[[0,0,0],[0,1,0],[1,1,0],[1,1,1]];weights=[1-g,g-r,r-b,b];}
    const out=[0,0,0];for(let i=0;i<4;i++){const v=at(...vertices[i]);for(let c=0;c<3;c++)out[c]+=v[c]*weights[i];}return out;
  }
  const out=[0,0,0];for(let db=0;db<2;db++)for(let dg=0;dg<2;dg++)for(let dr=0;dr<2;dr++){const w=(dr?r:1-r)*(dg?g:1-g)*(db?b:1-b),v=at(dr,dg,db);for(let c=0;c<3;c++)out[c]+=v[c]*w;}return out;
}
export function colorLookupPixels(image,amount){
  const settings=lookupSettings(amount),table=parseCube(settings.data),pixels=image.data,bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5],ox=Math.round(Number(amount.x)||0),oy=Math.round(Number(amount.y)||0);
  for(let i=0;i<pixels.length;i+=4){if(!pixels[i+3])continue;const out=sample(table,[pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],settings.interpolation==='tetrahedral'),p=i/4,x=p%image.width+ox,y=Math.floor(p/image.width)+oy,d=settings.dither?((bayer[(y&3)*4+(x&3)]+.5)/16-.5)/255:0;for(let c=0;c<3;c++)pixels[i+c]=clamp(out[c]+d)*255;}return image;
}
