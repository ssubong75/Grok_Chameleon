// Conjugate gradients on sparse normal equations, following PhotoCraft photo_util.rs.
export class SparseLeastSquares{
  constructor(size){this.size=size;this.rows=[];}
  add(row,rhs,weight=1){this.rows.push([row.map(([i,c])=>[i,c*weight]),rhs*weight]);}
  solve(initial,iterations){const n=this.size,x=new Float64Array(initial),rows=this.rows.length,offsets=new Uint32Array(rows+1),rhs=new Float64Array(rows);let count=0;for(let i=0;i<rows;i++){offsets[i]=count;count+=this.rows[i][0].length;rhs[i]=this.rows[i][1];}offsets[rows]=count;const indices=new Uint32Array(count),coefficients=new Float64Array(count);let k=0;for(const [row]of this.rows)for(const [i,c]of row){indices[k]=i;coefficients[k++]=c;}
    const ax=(v,out)=>{for(let r=0;r<rows;r++){let sum=0;for(let j=offsets[r];j<offsets[r+1];j++)sum+=coefficients[j]*v[indices[j]];out[r]=sum;}};
    const transpose=(v,out)=>{out.fill(0);for(let r=0;r<rows;r++)for(let j=offsets[r];j<offsets[r+1];j++)out[indices[j]]+=coefficients[j]*v[r];};
    const r=new Float64Array(rows),q=new Float64Array(rows),s=new Float64Array(n);ax(x,r);for(let i=0;i<rows;i++)r[i]=rhs[i]-r[i];transpose(r,s);const p=new Float64Array(s);let gamma=s.reduce((sum,v)=>sum+v*v,0),g0=Math.max(1e-30,gamma);
    for(let iteration=0;iteration<iterations;iteration++){if(gamma<=g0*1e-20)break;ax(p,q);let qq=0;for(let i=0;i<rows;i++)qq+=q[i]*q[i];if(qq<=1e-300)break;const alpha=gamma/qq;for(let i=0;i<n;i++)x[i]+=alpha*p[i];for(let i=0;i<rows;i++)r[i]-=alpha*q[i];transpose(r,s);let next=0;for(let i=0;i<n;i++)next+=s[i]*s[i];const beta=next/gamma;gamma=next;for(let i=0;i<n;i++)p[i]=s[i]+beta*p[i];}
    return x;
  }
}
