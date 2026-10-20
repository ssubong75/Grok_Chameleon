import {bindText} from './i18n.js';
import {typeSizeField,typeSizeFactor} from './type-units.js';
import {mountFontPreview} from './font-preview.js';
import {applyCharacterStyle,normalizeTextRuns,rebaseTextRuns} from './rich-text.js';

export function mountCharacterControls(textarea,initialRuns,fontOptions,preferences={}){
  let value=textarea.value,runs=normalizeTextRuns(value,initialRuns),start=0,end=0;
  const panel=document.createElement('fieldset');panel.className='character-styles';
  const legend=document.createElement('legend');legend.textContent='Selected Characters';panel.append(legend);
  const hint=document.createElement('p');hint.textContent='Select characters in the Text field, then apply their formatting.';panel.append(hint);
  const controls={},grid=document.createElement('div');grid.className='character-style-fields';panel.append(grid);
  function field(key,title,type,options){
    const label=document.createElement('label');label.textContent=title;const input=document.createElement(options?'select':'input');
    if(options)for(const [value,text]of [['','Unchanged'],...options]){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}
    else{input.type=type;input.placeholder='Unchanged';}
    controls[key]=input;label.append(input);grid.append(label);return input;
  }
  const font=field('font','Font','text',fontOptions);
  const removeFontPreview=preferences.loadFont?mountFontPreview(font,preferences.fontPreview,preferences.loadFont,preferences.recentFonts):()=>{};
  const sizeSpec=typeSizeField(48,preferences),size=field('size',sizeSpec.label,'number');size.min=String(sizeSpec.min);size.max=String(sizeSpec.max);size.step='any';const sizeLabel=size.closest('label');bindText(sizeLabel,'Size');sizeLabel.insertBefore(document.createTextNode(sizeSpec.labelSuffix),size);
  const tracking=field('tracking','Tracking (px)','number');tracking.min='-100';tracking.max='1000';tracking.step='any';
  const shift=field('baselineShift','Baseline Shift (px)','number');shift.min='-5000';shift.max='5000';shift.step='any';
  const colorLabel=document.createElement('label'),useColor=document.createElement('input'),color=document.createElement('input');useColor.type='checkbox';color.type='color';color.value='#000000';color.setAttribute('aria-label','Character color');colorLabel.append(useColor,document.createTextNode('Apply Color'),color);grid.append(colorLabel);
  for(const [key,title]of [['bold','Bold'],['italic','Italic'],['underline','Underline'],['strike','Strikethrough']])field(key,title,'text',[['true','On'],['false','Off']]);
  const status=document.createElement('p');status.setAttribute('aria-live','polite');panel.append(status);
  const actions=document.createElement('div');actions.className='character-style-actions';
  const apply=document.createElement('button'),reset=document.createElement('button');apply.type=reset.type='button';apply.textContent='Apply to Selection';reset.textContent='Use Layer Style';actions.append(apply,reset);panel.append(actions);
  textarea.closest('label').after(panel);
  function selection(){start=textarea.selectionStart;end=textarea.selectionEnd;status.textContent=start===end?'No characters selected.':`Selected: ${textarea.value.slice(start,end)}`;apply.disabled=reset.disabled=start===end;}
  textarea.addEventListener('select',selection);textarea.addEventListener('keyup',selection);textarea.addEventListener('pointerup',selection);
  textarea.addEventListener('input',()=>{runs=rebaseTextRuns(value,textarea.value,runs);value=textarea.value;selection();});
  function update(clear){
    const patch={};for(const [key,input]of Object.entries(controls)){input.setCustomValidity('');if(!clear&&input.value!==''){if(input.type==='number'){if(!input.checkValidity()){input.reportValidity();return;}patch[key]=Number(input.value)*(key==='size'?typeSizeFactor(preferences):1);}else patch[key]=['bold','italic','underline','strike'].includes(key)?input.value==='true':input.value;}}
    if(!clear&&useColor.checked)patch.color=color.value;
    if(start===end)return;runs=applyCharacterStyle(value,runs,start,end,patch,clear);status.textContent=clear?'Selected characters now use the layer style.':'Formatting applied to selected characters.';
    textarea.focus();textarea.setSelectionRange(start,end);
  }
  apply.onclick=()=>update(false);reset.onclick=()=>update(true);selection();
  return{getRuns:()=>normalizeTextRuns(textarea.value,runs),dispose:removeFontPreview};
}
