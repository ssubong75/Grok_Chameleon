import {typeSizeField,parseTypeSize} from './type-units.js';
import {normalizeTextRuns,rebaseTextRuns} from './rich-text.js';
import {warpStyles} from './warp-presets.js';
export function typeFields(old,position,fontOptions,defaults){
  const n=(key,label,value,min=-32767,max=32767,step='any')=>({key,label,type:'number',value,min,max,step});
  return[{key:'text',label:'Text',type:'textarea',value:old?.value??(defaults.fillPlaceholder===false?'':'Lorem ipsum')},{key:'font',label:'Font Family',options:fontOptions,value:old?.font||defaults.font},typeSizeField(old?.size||defaults.size,defaults),{key:'color',label:'Color',type:'color',value:old?.color||defaults.color},{key:'mode',label:'Type',options:[['point','Point Text'],['paragraph','Paragraph Text']],value:old?.mode||position.mode||'point'},n('x','X (px)',position.x),n('y','Y (px)',position.y),n('boxWidth','Paragraph Width (px)',old?.boxWidth||position.boxWidth||400,1,16000),n('boxHeight','Paragraph Height (px)',old?.boxHeight||position.boxHeight||300,1,16000),{key:'orientation',label:'Orientation',options:[['horizontal','Horizontal'],['vertical','Vertical']],value:old?.orientation||position.orientation||'horizontal'},
    {key:'align',label:'Alignment',options:[['left','Left'],['center','Center'],['right','Right'],['justify','Justify, Last Line Left'],['justifyCenter','Justify, Last Line Center'],['justifyRight','Justify, Last Line Right'],['justifyAll','Justify All']],value:old?.align||'left'},
    n('tracking','Tracking (px)',old?.tracking??0,-100,1000),n('leading','Line Height',old?.leading??1.2,.1,10,.1),n('leadingPx','Fixed Line Height (px, 0 = Auto)',old?.leadingPx||0,0,20000),n('baselineShift','Baseline Shift (px)',old?.baselineShift||0,-5000,5000),n('startIndent','Start Indent (px)',old?.startIndent||0,-5000,5000),n('endIndent','End Indent (px)',old?.endIndent||0,-5000,5000),n('firstLineIndent','First Line Indent (px)',old?.firstLineIndent||0,-5000,5000),n('spaceBefore','Space Before (px)',old?.spaceBefore||0,0,5000),n('spaceAfter','Space After (px)',old?.spaceAfter||0,0,5000),
    {key:'direction',label:'Text Direction',options:[['ltr','Left to Right'],['rtl','Right to Left']],value:old?.direction||'ltr'},{key:'kerning',label:'Kerning',options:[['metrics','Metrics'],['off','Off']],value:old?.kerning||'metrics'},{key:'caps',label:'Capitalization',options:[['normal','Normal'],['all','All Caps']],value:old?.caps||'normal'},
    ...['bold','italic','underline','strike'].map(key=>({key,label:({bold:'Bold',italic:'Italic',underline:'Underline',strike:'Strikethrough'})[key],type:'checkbox',value:old?.[key]})),
    {key:'textPath',label:'Text Path',options:[['','None'],...(old?.path?[['__attached__','Keep Current Text Path']]:[]),...(defaults.paths||[]).filter(path=>path.nodes?.length>=2).map(path=>[path.id,path.name||'Path'])],value:defaults.pathChoice||(old?.path?'__attached__':'')},
    n('pathOffset','Path Start Offset (px)',old?.pathOffset||0),n('pathBaseline','Path Baseline Offset (px)',old?.pathBaseline||0),{key:'pathReverse',label:'Reverse Path Direction',type:'checkbox',value:old?.pathReverse},{key:'pathFlip',label:'Flip Text Across Path',type:'checkbox',value:old?.pathFlip},
    {key:'warpStyle',label:'Warp',options:[['none','None'],...warpStyles],value:old?.warpStyle||'none'},
    {key:'warpAxis',label:'Warp Direction',options:[['horizontal','Horizontal'],['vertical','Vertical']],value:old?.warpAxis||'horizontal'},
    n('warpBend','Warp Bend (%)',old?.warpBend??50,-100,100),n('warpHorizontal','Warp Horizontal Distortion (%)',old?.warpHorizontal||0,-100,100),n('warpVertical','Warp Vertical Distortion (%)',old?.warpVertical||0,-100,100),
    n('angle','Rotation (°)',old?.angle||0,-360,360),n('scaleX','Horizontal Scale (%)',old?.scaleX??100,1,1000),n('scaleY','Vertical Scale (%)',old?.scaleY??100,1,1000),n('skew','Slant (°)',old?.skew||0,-85,85)];
}
export function parseType(values,old,units={}){
  const text={...old,value:String(values.text).replace(/\r\n?/g,'\n'),font:String(values.font).replace(/["\\]/g,''),color:values.color,mode:values.mode,orientation:values.orientation,align:values.align,direction:values.direction,kerning:values.kerning,caps:values.caps,x:old?.x??0,y:old?.y??0};
  for(const key of ['size','boxWidth','boxHeight','tracking','leading','leadingPx','baselineShift','startIndent','endIndent','firstLineIndent','spaceBefore','spaceAfter','angle','scaleX','scaleY','skew','pathOffset','pathBaseline','warpBend','warpHorizontal','warpVertical']){
    text[key]=key==='size'?parseTypeSize(values[key],units):Number(values[key]);if(!Number.isFinite(text[key]))throw Error('Enter valid text metrics.');
  }
  for(const key of ['bold','italic','underline','strike','pathReverse','pathFlip'])text[key]=Boolean(values[key]);
  text.warpStyle=warpStyles.some(([id])=>id===values.warpStyle)?values.warpStyle:'none';text.warpAxis=values.warpAxis==='vertical'?'vertical':'horizontal';
  if(!values.textPath){delete text.path;delete text.pathId;}
  text.runs=values.runs?normalizeTextRuns(text.value,values.runs):rebaseTextRuns(old?.value||'',text.value,old?.runs);
  return text;
}
