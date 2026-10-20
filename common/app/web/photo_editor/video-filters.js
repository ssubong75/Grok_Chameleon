export function deinterlace(image,settings={}){
  const {width,height,data}=image,source=new Uint8ClampedArray(data),originX=Number(settings.x)||0,originY=Number(settings.y)||0,documentWidth=Number(settings.documentWidth)||width,documentHeight=Number(settings.documentHeight)||height,even=settings.eliminate==='evenFields',interpolate=settings.createBy!=='duplication';
  const read=(x,y,c)=>y<0||y>=height?0:source[(y*width+x)*4+c];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const gx=x+originX,gy=y+originY;if(gx<0||gy<0||gx>=documentWidth||gy>=documentHeight||(gy%2===0)===even)continue;
    const above=gy>0?y-1:null,below=gy+1<documentHeight?y+1:null,rows=interpolate&&above!==null&&below!==null?[above,below]:above!==null?[above]:below!==null?[below]:[];
    if(!rows.length)continue;const sum=[0,0,0];let alpha=0;for(const row of rows){const a=read(x,row,3)/255;alpha+=a;for(let c=0;c<3;c++)sum[c]+=read(x,row,c)*a;}
    const index=(y*width+x)*4;for(let c=0;c<3;c++)data[index+c]=alpha?sum[c]/alpha:0;data[index+3]=alpha/rows.length*255;
  }
  return image;
}
export function ntscColors(image){
  const {data}=image,maximum=112.5/92.5,minimum=-27.5/92.5;
  for(let index=0;index<data.length;index+=4){const r=data[index]/255,g=data[index+1]/255,b=data[index+2]/255,y=.299*r+.587*g+.114*b,i=.595716*r-.274453*g-.321263*b,q=.211456*r-.522591*g+.311135*b,chroma=Math.hypot(i,q);if(chroma<=1e-7)continue;let scale=1;if(y+chroma>maximum)scale=Math.min(scale,Math.max(0,(maximum-y)/chroma));if(y-chroma<minimum)scale=Math.min(scale,Math.max(0,(y-minimum)/chroma));if(scale>=1)continue;const ii=i*scale,qq=q*scale;data[index]=(y+.9563*ii+.621*qq)*255;data[index+1]=(y-.2721*ii-.6474*qq)*255;data[index+2]=(y-1.107*ii+1.7046*qq)*255;}
  return image;
}
