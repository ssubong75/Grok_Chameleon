const weights=['Thin','ExtraLight','Light','Regular','Medium','SemiBold','Bold','ExtraBold','Black'];
export function fontStyles(entries=[]){
  const rows=[];for(const face of entries){const weight=Number(face.weight)||400,italic=face.style==='italic',name=face.subfamily||((italic&&weight===400)?'Italic':weights[Math.max(0,Math.min(8,Math.round(weight/100)-1))]+(italic?' Italic':''));rows.push({name,weight,italic,face});
    if(Number(face.weightMin)<Number(face.weightMax))for(let w=100;w<=900;w+=100)if(w>=face.weightMin&&w<=face.weightMax)rows.push({name:italic?(w===400?'Italic':weights[w/100-1]+' Italic'):weights[w/100-1],weight:w,italic,face});
  }rows.sort((a,b)=>a.weight-b.weight||Number(a.italic)-Number(b.italic)||a.name.localeCompare(b.name));return rows.filter((row,index)=>rows.findIndex(item=>item.name===row.name)===index);
}
