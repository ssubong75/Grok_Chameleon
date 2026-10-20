export function placeCoverage(alpha,alphaWidth,alphaHeight,originX,originY,docWidth,docHeight){
  const pixels=new Uint8ClampedArray(docWidth*docHeight);
  for(let row=0;row<alphaHeight;row++){const y=originY+row;if(y<0||y>=docHeight)continue;for(let col=0;col<alphaWidth;col++){const x=originX+col;if(x<0||x>=docWidth)continue;pixels[y*docWidth+x]=alpha[(row*alphaWidth+col)*4+3];}}
  return pixels;
}
