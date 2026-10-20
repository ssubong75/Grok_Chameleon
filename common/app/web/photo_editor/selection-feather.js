// Port of PhotoCraft crates/algo/src/selection_blur.rs at 56dbc89a38248f6e50db50d132de47be88494cf6.
// Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors. MIT; see vendor/photocraft.LICENSE-MIT.
const TERMS=5,FIT_TOL=.3/255,DIRECT_MAX_R=12,STRIP=64;
function solve(a,b){
  const n=b.length;
  for(let column=0;column<n;column++){
    let pivot=column;for(let row=column+1;row<n;row++)if(Math.abs(a[row][column])>Math.abs(a[pivot][column]))pivot=row;
    if(Math.abs(a[pivot][column])<1e-12)return null;[a[column],a[pivot]]=[a[pivot],a[column]];[b[column],b[pivot]]=[b[pivot],b[column]];
    for(let row=column+1;row<n;row++){const f=a[row][column]/a[column][column];for(let j=column;j<n;j++)a[row][j]-=f*a[column][j];b[row]-=f*b[column];}
  }
  const x=new Float64Array(n);for(let row=n-1;row>=0;row--){let sum=0;for(let j=row+1;j<n;j++)sum+=a[row][j]*x[j];x[row]=(b[row]-sum)/a[row][row];}return x.every(Number.isFinite)?x:null;
}
class Kernel{
  constructor(sigma,r,length,extend){
    let total=1;const g=j=>Math.exp(-j*j/(2*sigma*sigma));for(let j=1;j<=r;j++)total+=2*g(j);
    this.r=extend?r:Math.min(r,Math.max(0,length-1));this.extend=extend;const size=this.r,taps=Float64Array.from({length:size+1},(_,j)=>g(j)/total);
    this.taps=Float32Array.from({length:2*size+1},(_,j)=>taps[Math.abs(j-size)]);if(size<=DIRECT_MAX_R)return;
    const omega=Float64Array.from({length:TERMS},(_,k)=>Math.PI*(k+1)/(size+1)),a=Array.from({length:TERMS+1},()=>new Float64Array(TERMS+1)),b=new Float64Array(TERMS+1);
    for(let j=0;j<=size;j++){const weight=j?2:1,phi=[1,...omega.map(w=>Math.cos(w*j))];for(let p=0;p<=TERMS;p++){b[p]+=weight*phi[p]*taps[j];for(let q=0;q<=TERMS;q++)a[p][q]+=weight*phi[p]*phi[q];}}
    const coefficients=solve(a,b);if(!coefficients)return;
    let error=0;for(let j=0;j<=size;j++){let value=coefficients[0];for(let k=0;k<TERMS;k++)value+=coefficients[k+1]*Math.cos(omega[k]*j);error+=(j?2:1)*Math.abs(value-taps[j]);}if(!Number.isFinite(error)||error/2>FIT_TOL)return;
    this.taps=null;this.a0=coefficients[0];this.a=coefficients.slice(1);this.omega=omega;this.rot=Array.from(omega,w=>[Math.cos(w),-Math.sin(w)]);this.out=Array.from(omega,w=>[Math.cos(w*size),-Math.sin(w*size)]);this.in=Array.from(omega,w=>[Math.cos(w*size),Math.sin(w*size)]);this.full=Float64Array.from(omega,w=>{let value=1;for(let j=1;j<=size;j++)value+=2*Math.cos(w*j);return value;});
  }
  line(src,dst,runs){
    const n=src.length,r=this.r,at=i=>i<0||i>=n?(this.extend?src[Math.max(0,Math.min(n-1,i))]:0):src[i];
    if(this.taps){dst.fill(0);for(let k=0;k<this.taps.length;k++){const weight=this.taps[k];if(!weight)continue;for(let x=0;x<n;x++)dst[x]+=weight*at(x+k-r);}return;}
    if(!n)return;runs[n-1]=n;for(let i=n-2;i>=0;i--)runs[i]=src[i]===src[i+1]?runs[i+1]:i+1;
    let have=false,sb=0;const re=new Float64Array(TERMS),im=new Float64Array(TERMS);
    for(let x=0;x<n;x++){
      const lo=Math.max(0,x-r),hi=Math.min(n,x+r+1),c=src[lo];
      if(runs[lo]>=hi&&(this.extend||c===0||x>=r&&x+r<n)){dst[x]=c;sb=c*(2*r+1);for(let k=0;k<TERMS;k++){re[k]=c*this.full[k];im[k]=0;}have=true;continue;}
      if(have){const gone=at(x-1-r),come=at(x+r);sb+=come-gone;for(let k=0;k<TERMS;k++){const a=re[k]-gone*this.out[k][0],b=im[k]-gone*this.out[k][1],[cr,ci]=this.rot[k];re[k]=a*cr-b*ci+come*this.in[k][0];im[k]=a*ci+b*cr+come*this.in[k][1];}}
      else{sb=0;re.fill(0);im.fill(0);for(let j=-r;j<=r;j++){const value=at(x+j);if(!value)continue;sb+=value;for(let k=0;k<TERMS;k++){re[k]+=value*Math.cos(this.omega[k]*j);im[k]+=value*Math.sin(this.omega[k]*j);}}have=true;}
      let value=this.a0*sb;for(let k=0;k<TERMS;k++)value+=this.a[k]*re[k];dst[x]=value;
    }
  }
  strip(input,width,height,x0,span,output){
    const r=this.r,at=(y,x)=>y<0||y>=height?(this.extend?input[Math.max(0,Math.min(height-1,y))*width+x0+x]:0):input[y*width+x0+x];
    if(this.taps){for(let y=0;y<height;y++)for(let x=0;x<span;x++){let sum=0;for(let k=0;k<this.taps.length;k++)sum+=this.taps[k]*at(y+k-r,x);output[y*width+x0+x]=sum;}return;}
    const flags=new Float64Array(height),runs=new Uint32Array(height);flags.fill(NaN);
    for(let y=0;y<height;y++){const first=at(y,0);let equal=true;for(let x=1;x<span;x++)if(at(y,x)!==first){equal=false;break;}if(equal)flags[y]=first;}
    if(height)runs[height-1]=height;for(let y=height-2;y>=0;y--)runs[y]=Number.isFinite(flags[y])&&flags[y]===flags[y+1]?runs[y+1]:y+1;
    const sb=new Float64Array(span),re=Array.from({length:TERMS},()=>new Float64Array(span)),im=Array.from({length:TERMS},()=>new Float64Array(span));let have=false;
    for(let y=0;y<height;y++){
      const lo=Math.max(0,y-r),hi=Math.min(height,y+r+1),c=flags[lo];
      if(Number.isFinite(c)&&runs[lo]>=hi&&(this.extend||c===0||y>=r&&y+r<height)){for(let x=0;x<span;x++)output[y*width+x0+x]=c;sb.fill(c*(2*r+1));for(let k=0;k<TERMS;k++){re[k].fill(c*this.full[k]);im[k].fill(0);}have=true;continue;}
      if(have){
        for(let x=0;x<span;x++)sb[x]+=at(y+r,x)-at(y-1-r,x);
        for(let k=0;k<TERMS;k++){const [cr,ci]=this.rot[k],[o0,o1]=this.out[k],[i0,i1]=this.in[k];for(let x=0;x<span;x++){const gone=at(y-1-r,x),come=at(y+r,x),a=re[k][x]-gone*o0,b=im[k][x]-gone*o1;re[k][x]=a*cr-b*ci+come*i0;im[k][x]=a*ci+b*cr+come*i1;}}
      }else{
        sb.fill(0);for(let k=0;k<TERMS;k++){re[k].fill(0);im[k].fill(0);}
        for(let j=-r;j<=r;j++){for(let x=0;x<span;x++)sb[x]+=at(y+j,x);for(let k=0;k<TERMS;k++){const cs=Math.cos(this.omega[k]*j),sn=Math.sin(this.omega[k]*j);for(let x=0;x<span;x++){const value=at(y+j,x);re[k][x]+=value*cs;im[k][x]+=value*sn;}}}have=true;
      }
      for(let x=0;x<span;x++){let value=this.a0*sb[x];for(let k=0;k<TERMS;k++)value+=this.a[k]*re[k][x];output[y*width+x0+x]=value;}
    }
  }
}
export function featherCoverage(input,width,height,radius,extend=false){
  if(input.length!==width*height)throw Error('Selection dimensions changed.');const sigma=Math.min(100000,Math.max(0,Number(radius)||0));if(sigma<.1||!input.length)return new Float32Array(input);
  const r=Math.ceil(3*sigma);let left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(input[y*width+x]!==0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  if(left>=right)return new Float32Array(input.length);
  const x0=Math.max(0,left-r),y0=Math.max(0,top-r),x1=Math.min(width,right+r),y1=Math.min(height,bottom+r),w=x1-x0,h=y1-y0,temp=new Float32Array(w*h),output=new Float32Array(w*h),horizontal=new Kernel(sigma,r,w,extend),vertical=new Kernel(sigma,r,h,extend),runs=new Uint32Array(w),line=new Float32Array(w),filtered=new Float32Array(w);
  for(let y=top;y<bottom;y++){line.set(input.subarray(y*width+x0,y*width+x1));horizontal.line(line,filtered,runs);temp.set(filtered,(y-y0)*w);}
  for(let x=0;x<w;x+=STRIP)vertical.strip(temp,w,h,x,Math.min(STRIP,w-x),output);
  const result=new Float32Array(input.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const value=output[y*w+x];result[(y+y0)*width+x+x0]=Math.abs(value)<1e-7*255?0:value;}return result;
}
