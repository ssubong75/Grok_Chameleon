// PhotoCraft compose/adjust.rs curve_lut; PSD contour coordinates are0..255.
export function effectContour(contour){
  if(!contour?.curve?.length)return null;
  if(!Array.isArray(contour.curve)||contour.curve.length>256)throw Error('Invalid effect contour.');
  const sorted=contour.curve.map(p=>({...p})).sort((a,b)=>a.x-b.x),points=sorted.map(p=>[p.x/255,p.y/255]);
  if(points.some((p,i)=>p.some(v=>!Number.isFinite(v)||v<0||v>1)||i&&p[0]-points[i-1][0]<1e-6))throw Error('Invalid effect contour points.');
  if(sorted.some(p=>p.corner)){
    let result=null,start=0;for(let i=1;i<sorted.length;i++){if(!sorted[i].corner&&i!==sorted.length-1)continue;const segment=sorted.slice(start,i+1).map(({corner,...p})=>p),table=effectContour({curve:segment});if(!result)result=table;else for(let k=0;k<4096;k++)if(k/4095>=segment[0].x/255)result[k]=table[k];start=i;}if(result)return result;
  }
  const n=points.length,out=new Float32Array(4096);if(n<2)return Float32Array.from(out,(_,i)=>i/4095);
  const second=new Float64Array(n),upper=new Float64Array(n),rhs=new Float64Array(n);
  for(let i=1;i<n-1;i++){const h0=points[i][0]-points[i-1][0],h1=points[i+1][0]-points[i][0],a=h0/6,b=(h0+h1)/3,c=h1/6,r=(points[i+1][1]-points[i][1])/h1-(points[i][1]-points[i-1][1])/h0,den=b-a*upper[i-1];upper[i]=c/den;rhs[i]=(r-a*rhs[i-1])/den;}
  for(let i=n-2;i>=1;i--)second[i]=rhs[i]-upper[i]*second[i+1];let segment=0;
  for(let i=0;i<out.length;i++){const x=i/4095;if(x<=points[0][0]){out[i]=points[0][1];continue;}if(x>=points[n-1][0]){out[i]=points[n-1][1];continue;}while(segment<n-2&&x>points[segment+1][0])segment++;const [x0,y0]=points[segment],[x1,y1]=points[segment+1],h=x1-x0,a=(x1-x)/h,b=(x-x0)/h;out[i]=Math.max(0,Math.min(1,a*y0+b*y1+((a*a*a-a)*second[segment]+(b*b*b-b)*second[segment+1])*h*h/6));}
  return out;
}
export function contourValue(table,value){value=Math.max(0,Math.min(1,value));if(!table)return value;const x=value*4095,i=Math.floor(x);return table[i]+(table[Math.min(4095,i+1)]-table[i])*(x-i);}
