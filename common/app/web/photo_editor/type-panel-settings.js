// Shared panel bounds match type-controls.js; patches preserve unrelated rich-text styles.
export const characterPanelFields=[
  {key:'font',label:'Font',type:'text',fallback:'Inter'},
  {key:'size',label:'Size (px)',type:'number',min:.1,max:2000,fallback:48},
  {key:'tracking',label:'Tracking (px)',type:'number',min:-100,max:1000,fallback:0},
  {key:'leadingPx',label:'Leading (px, 0 Auto)',type:'number',min:0,max:20000,fallback:0},
  {key:'baselineShift',label:'Baseline (px)',type:'number',min:-5000,max:5000,fallback:0},
  {key:'color',label:'Color',type:'color',fallback:'#000000'},
  ...['bold','italic','underline','strike'].map(key=>({key,label:({bold:'Bold',italic:'Italic',underline:'Underline',strike:'Strike'})[key],type:'checkbox',fallback:false}))
];
export const paragraphPanelFields=[
  {key:'align',label:'Alignment',options:['left','center','right','justify','justifyCenter','justifyRight','justifyAll'],fallback:'left'},
  {key:'direction',label:'Direction',options:['ltr','rtl'],fallback:'ltr'},
  ...['startIndent','endIndent','firstLineIndent','spaceBefore','spaceAfter'].map(key=>({key,label:({startIndent:'Start indent',endIndent:'End indent',firstLineIndent:'First line',spaceBefore:'Space before',spaceAfter:'Space after'})[key]+' (px)',type:'number',min:key.startsWith('space')?0:-5000,max:5000,fallback:0}))
];
export function patchTypePanel(text,key,input){
  const field=[...characterPanelFields,...paragraphPanelFields].find(f=>f.key===key);if(!field)throw Error('Unknown type setting.');let value=input;
  if(field.options){if(!field.options.includes(value))throw Error('Choose a valid '+field.label+'.');}
  else if(field.type==='number'){value=Number(value);if(input===''||!Number.isFinite(value)||value<field.min||value>field.max)throw Error(field.label+' must be between '+field.min+' and '+field.max+'.');}
  else if(field.type==='checkbox'){if(typeof value!=='boolean')throw Error('Invalid type toggle.');}
  else if(field.type==='color'){if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('Choose a valid text color.');}
  else{value=String(value).replace(/["\\]/g,'').trim();if(!value||value.length>256)throw Error('Enter a font family.');}
  const next=structuredClone(text);next[key]=value;
  if(['font','size','tracking','baselineShift','color','bold','italic','underline','strike'].includes(key)&&Array.isArray(next.runs))for(const run of next.runs)run.style={...run.style,[key]:value};
  return next;
}
