const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function fieldSample(field,x,y,key){const gx=clamp(x/field.spacing,0,field.width-1),gy=clamp(y/(field.spacingY||field.spacing),0,field.height-1),left=Math.floor(gx),top=Math.floor(gy),right=Math.min(field.width-1,left+1),bottom=Math.min(field.height-1,top+1),fx=gx-left,fy=gy-top,values=field[key],a=values[top*field.width+left]*(1-fx)+values[top*field.width+right]*fx,b=values[bottom*field.width+left]*(1-fx)+values[bottom*field.width+right]*fx;return a*(1-fy)+b*fy;}
export function deformPixels(image,field){
  if(!field||!Number.isInteger(field.width)||!Number.isInteger(field.height)||field.width<2||field.height<2||field.width*field.height>1000000||!Number.isFinite(field.spacing)||field.spacing<=0||!field.dx||!field.dy)throw Error('Invalid deformation field.');
  const source=new Uint8ClampedArray(image.data),{width,height,data}=image;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=clamp(x+fieldSample(field,x,y,'dx'),0,width-1),sy=clamp(y+fieldSample(field,x,y,'dy'),0,height-1),left=Math.floor(sx),top=Math.floor(sy),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),fx=sx-left,fy=sy-top,sums=[0,0,0];let alpha=0;
    for(const [px,py,w]of [[left,top,(1-fx)*(1-fy)],[right,top,fx*(1-fy)],[left,bottom,(1-fx)*fy],[right,bottom,fx*fy]]){const i=(py*width+px)*4,a=source[i+3]/255*w;alpha+=a;for(let c=0;c<3;c++)sums[c]+=source[i+c]*a;}const i=(y*width+x)*4;for(let c=0;c<3;c++)data[i+c]=alpha?sums[c]/alpha:0;data[i+3]=alpha*255;
  }return image;
}
