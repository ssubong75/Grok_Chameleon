const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function blurSpans(radius,inside){
  if(radius<.5)return{rows:[[0,0,0]],count:1};const extent=Math.ceil(Math.max(0,radius)),rows=[];let count=0;
  for(let dy=-extent;dy<=extent;dy++){let run=null;for(let dx=-extent;dx<=extent+1;dx++){const hit=dx<=extent&&inside(dx/radius,dy/radius);if(hit&&run===null)run=dx;else if(!hit&&run!==null){rows.push([dy,run,dx-1]);count+=dx-run;run=null;}}}
  return rows.length?{rows,count}:{rows:[[0,0,0]],count:1};
}
export function tilePrefix(source,width,height,tileX,tileY,tileWidth,tileHeight,margin,boost=0,threshold=1){
  const ww=tileWidth+margin*2,wh=tileHeight+margin*2,stride=(ww+1)*4,prefix=new Float64Array(stride*wh);
  for(let y=0;y<wh;y++)for(let x=0;x<ww;x++){
    const gx=tileX-margin+x,gy=tileY-margin+y,row=y*stride,previous=row+x*4,next=previous+4;
    for(let c=0;c<4;c++)prefix[next+c]=prefix[previous+c];if(gx<0||gy<0||gx>=width||gy>=height)continue;
    const index=(gy*width+gx)*4,a=source[index+3]/255,luma=(source[index]*.299+source[index+1]*.587+source[index+2]*.114)/255,t=clamp((luma-threshold)/.02,0,1),gain=1+boost*t*t*(3-2*t);
    for(let c=0;c<3;c++)prefix[next+c]+=source[index+c]/255*a*gain;prefix[next+3]+=a;
  }
  return(kernel,x,y,output)=>{output.fill(0);for(const [dy,left,right]of kernel.rows){const yy=y+dy;if(yy<0||yy>=wh)continue;const lo=yy*stride+clamp(x+left,0,ww)*4,hi=yy*stride+clamp(x+right+1,0,ww)*4;for(let c=0;c<4;c++)output[c]+=prefix[hi+c]-prefix[lo+c];}for(let c=0;c<4;c++)output[c]/=kernel.count;};
}
