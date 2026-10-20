import {wandCoverage} from './selection-wand.js';
import {quickSelect} from './segment-quick.js';
import {selectFocus} from './segment-focus.js';
import {colorRange} from './color-range.js';
import {selectSubject} from './segment-subject.js';
import {selectObject,selectObjectAt} from './segment-object.js';
import {selectSky} from './segment-sky.js';
import {refineSelection,decontaminateSelection} from './refine-selection.js';
import {boxMean} from './photo-math.js';
import {modifyCoverage} from './selection-morphology.js';
self.onmessage=event=>{try{const {width:w,height:h,buffer,mask,operation,settings}=event.data,input=new Uint8ClampedArray(mask),image={width:w,height:h,data:new Uint8ClampedArray(buffer)};let result;if(event.data.brush)settings.brushMap=new Int16Array(event.data.brush);
  if(operation==='wand')result=wandCoverage(image,settings);
  else if(operation==='objectAt')result=selectObjectAt(image,settings);
  else if(operation==='quick')result=quickSelect(image,settings);
  else if(operation==='focus')result=selectFocus(image,settings);
  else if(operation==='colorRange'){result=colorRange(image,settings);if(settings.scope&&settings.combine==='replace'&&input.length===result.length)for(let i=0;i<result.length;i++)result[i]=Math.min(result[i],input[i]);}
  else if(operation==='subject')result=selectSubject(image);
  else if(operation==='removeBackground'){result=selectSubject(image);if(!result.some(value=>value>0))throw Error('No subject found.');result=refineSelection(image,result,{radius:2,smartRadius:true,smooth:10,feather:.5,contrast:10,shiftEdge:0});}
  else if(operation==='object')result=selectObject(image,settings);
  else if(operation==='sky')result=selectSky(image,settings);
  else if(operation==='refine')result=refineSelection(image,input,settings);
  else if(['feather','expand','contract','border'].includes(operation))result=modifyCoverage(input,w,h,operation,settings);
  else if(operation==='smooth'){const floats=Float32Array.from(input,v=>v/255),mean=boxMean(floats,w,h,Math.max(1,Math.round(settings.radius)));result=Uint8ClampedArray.from(mean,v=>v>=.5?255:0);}
  else if(operation==='grow'||operation==='similar'){const p=image.data,lo=[255,255,255,255],hi=[0,0,0,0],out=new Uint8ClampedArray(w*h),tolerance=Math.max(0,Math.min(255,Number(settings.tolerance)||0)),stack=[];let selected=0;for(let i=0;i<input.length;i++)if(input[i]>=128){for(let c=0;c<4;c++){lo[c]=Math.min(lo[c],p[i*4+c]);hi[c]=Math.max(hi[c],p[i*4+c]);}out[i]=255;stack.push(i);selected++;}if(!selected)throw Error('The selection is empty.');const inside=i=>[0,1,2,3].every(c=>p[i*4+c]>=lo[c]-tolerance-.000255&&p[i*4+c]<=hi[c]+tolerance+.000255);
    if(operation==='similar')for(let i=0;i<out.length;i++){if(inside(i))out[i]=255;}else while(stack.length){const i=stack.pop(),x=i%w,y=Math.floor(i/w);for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1])if(j>=0&&!out[j]&&inside(j)){out[j]=255;stack.push(j);}}result=out;
  }else throw Error('Unknown selection operation.');const output={width:w,height:h,mask:result.buffer},transfer=[result.buffer];if(operation==='refine'&&settings.decontaminate){decontaminateSelection(image,result,Number(settings.radius)||0,Number(settings.amount)||0);output.image=image.data.buffer;transfer.push(image.data.buffer);}self.postMessage(output,transfer);
}catch(error){self.postMessage({error:error.message||String(error)});}};
