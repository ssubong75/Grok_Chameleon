import {bindAttribute} from './i18n.js';
export function typeSizeFactor(options={}){const dpi=Number.isFinite(options.resolution)&&options.resolution>0?options.resolution:72;return options.typeUnits==='points'?dpi/(options.pointSize==='traditional'?72.27:72):options.typeUnits==='mm'?dpi/25.4:1;}
export function typeSizeField(px,options={}){const factor=typeSizeFactor(options),suffix=options.typeUnits==='points'?'pt':options.typeUnits==='mm'?'mm':'px';return{key:'size',required:true,label:'Size',labelSuffix:` (${suffix})`,type:'number',value:px/factor,min:.1/factor,max:2000/factor,step:'any'};}
export function installTypeSizeInput(input,getOptions){
  const oldStep=input.getAttribute('step');input.step='any';
  let pixels=Number(input.value)||48,factor=1,previous='';const low=Number(input.min)||1,high=Number(input.max)||1000,suffix=input.ownerDocument.createElement('span');suffix.className='type-size-unit';input.after(suffix);
  const sync=()=>{const options=getOptions(),next=typeSizeFactor(options),unit=options.typeUnits==='points'?'pt':options.typeUnits==='mm'?'mm':'px',key=unit+':'+next;if(key===previous)return;factor=next;previous=key;input.value=String(pixels/factor);input.min=String(low/factor);input.max=String(high/factor);suffix.textContent=unit;bindAttribute(input,'aria-label','Size',` (${unit})`);};
  const changed=()=>{const value=Number(input.value)*factor;if(input.value!==''&&Number.isFinite(value)&&value>=low&&value<=high)pixels=value;};const finish=()=>{changed();input.value=String(pixels/factor);};input.addEventListener('input',changed);input.addEventListener('change',finish);sync();
  return{pixels:()=>pixels,sync,dispose(){input.removeEventListener('input',changed);input.removeEventListener('change',finish);if(oldStep===null)input.removeAttribute('step');else input.setAttribute('step',oldStep);suffix.remove();}};
}

export function parseTypeSize(value,options={}){
  if(typeof value==='string'&&!value.trim())throw Error('Enter a valid type size.');
  const pixels=Number(value)*typeSizeFactor(options);
  if(!Number.isFinite(pixels)||pixels<.1-1e-9||pixels>2000+1e-9)throw Error('Type size must be between 0.1 and 2000 pixels.');
  return Math.max(.1,Math.min(2000,pixels));
}
