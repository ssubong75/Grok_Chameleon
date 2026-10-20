const D50=[0.96422,1,0.82521],TO_SRGB=[[3.133856,-1.616867,-0.490615],[-0.978768,1.916142,0.033454],[0.071945,-0.228991,1.405243]],DELTA=6/29;
function inverse(t){return t>DELTA?t*t*t:3*DELTA*DELTA*(t-4/29);}
function encode(v){return v<=0.0031308?v*12.92:1.055*v**(1/2.4)-0.055;}
export function labToSrgb(l,a,b){
  const fy=(l+16)/116,fx=fy+a/500,fz=fy-b/200,x=inverse(fx)*D50[0],y=inverse(fy)*D50[1],z=inverse(fz)*D50[2];
  return TO_SRGB.map(row=>{const lin=row[0]*x+row[1]*y+row[2]*z,clamped=lin<0?0:lin>1?1:lin;return encode(clamped);});
}
export function labBytesToSrgb(data){
  for(let i=0;i<data.length;i+=4){
    const [r,g,b]=labToSrgb(data[i]/255*100,data[i+1]-128,data[i+2]-128);
    data[i]=Math.round(r*255);data[i+1]=Math.round(g*255);data[i+2]=Math.round(b*255);
  }
  return data;
}
