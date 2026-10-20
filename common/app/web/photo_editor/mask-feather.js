const cache=new WeakMap();
// Source extended boxes: three passes per axis with exactly sigma² variance.
export function featherPlane(canvas,sigma,defaultValue,revision){
  sigma=Math.max(0,Math.min(1000,Number(sigma)||0));if(!sigma)return null;
  const previous=cache.get(canvas);if(previous&&previous.sigma===sigma&&previous.defaultValue===defaultValue&&previous.revision===revision)return previous;
  const variance=sigma*sigma/3;let radius=Math.max(0,Math.floor((Math.sqrt(12*variance+1)-1)/2));
  while(radius>0&&radius*(radius+1)/3>variance)radius--;
  while((radius+1)*(radius+2)/3<=variance)radius++;
  const n=2*radius+1,end=Math.max(0,Math.min(1,n*(radius*(radius+1)/3-variance)/(2*variance-2*(radius+1)**2))),padding=3*(radius+1),width=canvas.width+2*padding,height=canvas.height+2*padding;
  if(width*height>64000000)throw Error('The feathered mask exceeds the current 64 million sample limit.');
  const values=new Float32Array(width*height);values.fill(defaultValue);const raw=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)values[(y+padding)*width+x+padding]=raw[(y*canvas.width+x)*4+3]/255;
  const line=new Float32Array(Math.max(width,height)),scratch=new Float32Array(line.length),divisor=n+2*end;
  for(const horizontal of [true,false]){
    const length=horizontal?width:height,lines=horizontal?height:width,index=(k,p)=>horizontal?k*width+p:p*width+k;
    for(let k=0;k<lines;k++){
      for(let p=0;p<length;p++)line[p]=values[index(k,p)];
      for(let pass=0;pass<3;pass++){
        scratch.set(line.subarray(0,length));const get=p=>scratch[Math.max(0,Math.min(length-1,p))];let sum=0;for(let p=-radius;p<=radius;p++)sum+=get(p);let below=get(-radius-1);
        for(let p=0;p<length;p++){const above=get(p+radius+1),leaving=get(p-radius);line[p]=(sum+end*(below+above))/divisor;sum+=above-leaving;below=leaving;}
      }
      for(let p=0;p<length;p++)values[index(k,p)]=line[p];
    }
  }
  const result={sigma,defaultValue,revision,width,height,padding,values};cache.set(canvas,result);return result;
}
