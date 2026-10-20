// PhotoCraft compose/src/adjust.rs vibrance_px/vibrance_lin, 8-bit RGB working space.
const clamp=v=>Math.max(0,Math.min(1,v));
const decode=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const encode=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
export function vibranceSettings(amount){
  const vibrance=Number(typeof amount==='object'?amount?.vibrance??0:amount??0),saturation=Number(typeof amount==='object'?amount?.saturation??0:0);
  if(![vibrance,saturation].every(Number.isFinite)||Math.abs(vibrance)>100||Math.abs(saturation)>100)throw Error('Vibrance and Saturation must be between -100 and 100.');
  return{vibrance,saturation};
}
function vibranceLinear(color,v){
  const mx=Math.max(...color),mn=Math.min(...color),d=mx-mn;if(mx<=0||d<=1e-9)return color;
  const t=1-mn/mx,shape=t*(1-t)*(2-t+t*t)*mx*Math.max(0,1-mx);let t2,v2;
  if(v<0){const a=-v;t2=t*(1-a/4)*(1-a+a*t*(1+t)/2);v2=mx-a*shape;}
  else{
    const h=(mx===color[0]?((color[1]-color[2])/d%6+6)%6:mx===color[1]?(color[2]-color[0])/d+2:(color[0]-color[1])/d+4)*60;
    const w=h<=30?1:h<45?(45-h)/15:h<300?0:(h-300)/60,a=v*(1-w)+.64*v**1.6*w;
    const boost=(.5001*a+.0887*a*a)*t**.4374*(1-t)**.7573*Math.exp((-.8113+.5154*a+2.8026*(1-t))*Math.max(0,1-mx));
    t2=Math.min(1,t*(1+boost));v2=mx+v/4*shape;
  }
  const m2=v2*(1-t2),k=(v2-m2)/d;return color.map(x=>m2+(x-mn)*k);
}
export function vibrancePixels(image,amount){
  const settings=vibranceSettings(amount),v=settings.vibrance/100,s=settings.saturation/100,pixels=image.data;
  if(!v&&!s)return image;
  for(let i=0;i<pixels.length;i+=4){let color=[pixels[i],pixels[i+1],pixels[i+2]].map(x=>decode(x/255));if(v)color=vibranceLinear(color,v);if(s){const gray=.288*color[0]+.712*color[1];color=color.map(x=>clamp(gray+(1+s)*(x-gray)));}for(let c=0;c<3;c++)pixels[i+c]=encode(clamp(color[c]))*255;}
  return image;
}
