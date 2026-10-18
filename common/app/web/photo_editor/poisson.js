// Cascadic membrane/SOR solver ported from PhotoCraft algo/poisson.rs.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function sor(width,height,unknown,values,iterations,omega){
  const cells=[];for(let i=0;i<unknown.length;i++)if(unknown[i])cells.push(i);
  for(let iteration=0;iteration<iterations;iteration++){let largest=0;for(const i of cells){const x=i%width,y=Math.floor(i/width);let sum=0,count=0;if(x>0){sum+=values[i-1];count++;}if(x+1<width){sum+=values[i+1];count++;}if(y>0){sum+=values[i-width];count++;}if(y+1<height){sum+=values[i+width];count++;}if(!count)continue;const delta=omega*(sum/count-values[i]);values[i]+=delta;largest=Math.max(largest,Math.abs(delta));}if(largest<.00002)break;}
}
export function solveMembrane(width,height,unknown,values,depth=0){
  let unknownCount=0,knownCount=0,knownSum=0;for(let i=0;i<unknown.length;i++){if(unknown[i])unknownCount++;else{knownCount++;knownSum+=values[i];}}if(!unknownCount||!knownCount)return;
  if(width>=8&&height>=8&&unknownCount>64&&depth<16){
    const cw=Math.ceil(width/2),ch=Math.ceil(height/2),cu=new Uint8Array(cw*ch).fill(1),cv=new Float32Array(cw*ch);
    for(let cy=0;cy<ch;cy++)for(let cx=0;cx<cw;cx++){let sum=0,count=0;for(const [dx,dy]of [[0,0],[1,0],[0,1],[1,1]]){const x=cx*2+dx,y=cy*2+dy;if(x<width&&y<height&&!unknown[y*width+x]){sum+=values[y*width+x];count++;}}if(count){cu[cy*cw+cx]=0;cv[cy*cw+cx]=sum/count;}}
    solveMembrane(cw,ch,cu,cv,depth+1);
    for(let y=0;y<height;y++){const fy=clamp((y+.5)/2-.5,0,ch-1),y0=Math.floor(fy),y1=Math.min(ch-1,y0+1),ty=fy-y0;for(let x=0;x<width;x++){if(!unknown[y*width+x])continue;const fx=clamp((x+.5)/2-.5,0,cw-1),x0=Math.floor(fx),x1=Math.min(cw-1,x0+1),tx=fx-x0,a=cv[y0*cw+x0]+(cv[y0*cw+x1]-cv[y0*cw+x0])*tx,b=cv[y1*cw+x0]+(cv[y1*cw+x1]-cv[y1*cw+x0])*tx;values[y*width+x]=a+(b-a)*ty;}}
    sor(width,height,unknown,values,30,1.7);
  }else{const mean=knownSum/knownCount;for(let i=0;i<values.length;i++)if(unknown[i])values[i]=mean;sor(width,height,unknown,values,2000,1.85);}
}
export function seamlessClone(width,height,source,destination,mask){
  const output=new Uint8ClampedArray(destination);for(let channel=0;channel<4;channel++){const values=new Float32Array(width*height);for(let i=0;i<values.length;i++)if(!mask[i])values[i]=(destination[i*4+channel]-source[i*4+channel])/255;solveMembrane(width,height,mask,values);for(let i=0;i<values.length;i++)if(mask[i])output[i*4+channel]=source[i*4+channel]+values[i]*255;}return output;
}
