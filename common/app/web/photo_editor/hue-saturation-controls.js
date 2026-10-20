import {hueSaturationSettings,hueRanges} from './hue-saturation.js';
export function mountHueControls(body){
  const data=body.querySelector('[name="ranges"]'),colorize=body.querySelector('[name="colorize"]'),hue=body.querySelector('[name="hue"]'),saturation=body.querySelector('[name="saturation"]');if(!data||!colorize||!hue||!saturation)return;
  let ranges;try{ranges=hueSaturationSettings({ranges:data.value}).ranges;}catch{return;}
  data.closest('label').hidden=true;
  const section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Color Range';section.append(legend);
  const picker=document.createElement('select');picker.setAttribute('aria-label','Color Range');for(const [i,name]of hueRanges.entries()){const option=document.createElement('option');option.value=i;option.textContent=name[0].toUpperCase()+name.slice(1);picker.append(option);}section.append(picker);
  const fields=[];
  for(const [key,label,min,max]of [['hue','Hue',-180,180],['saturation','Saturation',-100,100],['lightness','Lightness',-100,100],['0','Fade-in Start',-360,720],['1','Fully On',-360,720],['2','Fade-out Start',-360,720],['3','Fade-out End',-360,720]]){
    const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=1;row.append(input);section.append(row);fields.push({key,input});
    input.addEventListener('input',()=>{const range=ranges[Number(picker.value)],value=Number(input.value);if(!Number.isFinite(value))return;if(/^\d$/.test(key))range.bounds[Number(key)]=value;else range[key]=value;data.value=JSON.stringify(ranges);data.dispatchEvent(new Event('input',{bubbles:true}));});
  }
  const display=()=>{const range=ranges[Number(picker.value)];for(const {key,input}of fields)input.value=/^\d$/.test(key)?range.bounds[Number(key)]:range[key];};picker.addEventListener('change',display);display();body.append(section);
  const bounds=()=>{hue.min=colorize.checked?0:-180;hue.max=colorize.checked?360:180;hue.value=Math.max(Number(hue.min),Math.min(Number(hue.max),Number(hue.value)||0));section.disabled=colorize.checked;};bounds();
  colorize.addEventListener('change',()=>{bounds();if(colorize.checked&&Number(saturation.value)===0)saturation.value=25;saturation.dispatchEvent(new Event('input',{bubbles:true}));});
}
