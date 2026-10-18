export function symmetricSegments(from,to,width,height,mode='none',count=4){
  const result=[[from,to]],mirrorX=p=>({x:width-p.x,y:p.y}),mirrorY=p=>({x:p.x,y:height-p.y});
  if(mode==='vertical'||mode==='dual')result.push([mirrorX(from),mirrorX(to)]);
  if(mode==='horizontal'||mode==='dual')result.push([mirrorY(from),mirrorY(to)]);
  if(mode==='dual')result.push([mirrorY(mirrorX(from)),mirrorY(mirrorX(to))]);
  if(mode==='radial'){count=Math.max(2,Math.min(32,Math.round(count)||4));const cx=width/2,cy=height/2;for(let i=1;i<count;i++){const angle=i/count*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),rotate=p=>({x:cx+(p.x-cx)*c-(p.y-cy)*s,y:cy+(p.x-cx)*s+(p.y-cy)*c});result.push([rotate(from),rotate(to)]);}}
  return result;
}
