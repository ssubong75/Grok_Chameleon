export function displaySingleChannel(data,channel,inColor=false){
  if(!Number.isInteger(channel)||channel<0||channel>3)throw Error('Invalid display channel.');
  for(let i=0;i<data.length;i+=4){const value=data[i+channel];for(let c=0;c<3;c++)data[i+c]=inColor&&channel<3?(c===channel?value:0):value;if(channel===3)data[i+3]=255;}
  return data;
}
