const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function smooth(buffer,width,height,channels,sigma){
  if(sigma<.3)return;let low=Math.floor(Math.sqrt(4*sigma*sigma+1));if(low%2===0)low--;low=Math.max(1,low);const m=clamp(Math.round((12*sigma*sigma-3*low*low-12*low-9)/(-4*low-4)),0,3),radii=Array.from({length:3},(_,i)=>((i<m?low:low+2)-1)/2);if(radii.every(r=>r===0))radii[0]=1;
  const scratch=new Float32Array(Math.max(width,height)*channels);
  for(const horizontal of [true,false])for(const radius of radii){if(!radius)continue;const length=horizontal?width:height,lines=horizontal?height:width,index=(line,p,c)=>horizontal?(line*width+p)*channels+c:(p*width+line)*channels+c;for(let line=0;line<lines;line++){for(let p=0;p<length;p++)for(let c=0;c<channels;c++)scratch[p*channels+c]=buffer[index(line,p,c)];for(let c=0;c<channels;c++){const at=p=>scratch[clamp(p,0,length-1)*channels+c];let sum=0;for(let p=-radius;p<=radius;p++)sum+=at(p);for(let p=0;p<length;p++){buffer[index(line,p,c)]=sum/(radius*2+1);sum+=at(p+radius+1)-at(p-radius);}}}}
}
