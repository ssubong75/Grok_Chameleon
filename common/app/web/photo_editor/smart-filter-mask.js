// PhotoCraft compose/src/filter_mask.rs: premultiplied mix and inverse unmix.
const clamp=v=>Math.max(0,Math.min(1,v));
function sample(image,x,y){
  const ix=Math.round(x-(image.x||0)),iy=Math.round(y-(image.y||0));
  return ix>=0&&iy>=0&&ix<image.width&&iy<image.height?(iy*image.width+ix)*4:-1;
}
export function combineFilterMask(base,filtered,mask,inverse=false){
  const x=Math.floor(Math.min(base.x||0,filtered.x||0)),y=Math.floor(Math.min(base.y||0,filtered.y||0));
  const width=Math.ceil(Math.max((base.x||0)+base.width,(filtered.x||0)+filtered.width))-x,height=Math.ceil(Math.max((base.y||0)+base.height,(filtered.y||0)+filtered.height))-y;
  if(width<1||height<1||width>32767||height>32767||width*height>64000000)throw Error('The smart-filter mask result exceeds the image size limit.');
  const data=new Uint8ClampedArray(width*height*4),outside=mask.extendWhite!==false?1:0;
  for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
    const px=x+xx,py=y+yy,b=sample(base,px,py),f=sample(filtered,px,py),m=sample(mask,px,py),k=m<0?outside:mask.data[m+3]/255,i=(yy*width+xx)*4,ba=b<0?0:base.data[b+3]/255,fa=f<0?0:filtered.data[f+3]/255;
    if(inverse&&k<1/1024){if(b>=0&&ba>0)data.set(base.data.subarray(b,b+4),i);continue;}
    const a=inverse?clamp(ba+(fa-ba)/k):ba+(fa-ba)*k;data[i+3]=a*255;if(a<=0)continue;
    for(let c=0;c<3;c++){const bp=b<0?0:base.data[b+c]/255*ba,fp=f<0?0:filtered.data[f+c]/255*fa,pm=inverse?bp+(fp-bp)/k:bp+(fp-bp)*k;data[i+c]=clamp(pm/a)*255;}
  }
  return{x,y,width,height,data};
}
