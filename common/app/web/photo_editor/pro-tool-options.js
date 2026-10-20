/** Options bar copied from the running PhotoCraft Pro toolbar, one layout per tool. */
export function mountProOptions({bindText,t,command,state,getFontStyles=()=>[]}){
  const bar=document.createElement('span');
  bar.id='pro-options';
  const options=document.querySelector('#options');
  options.append(bar);
  document.querySelector('#options-home')?.nextElementSibling?.classList.add('keep-sep');
  document.querySelector('#options-tool-menu')?.nextElementSibling?.classList.add('keep-sep');
  document.body.classList.add('pro-bar');
  const opt=state.proOptions||(state.proOptions={
    moveAuto:true,moveTarget:'group',moveTransform:false,
    feather:0,antiAlias:true,marqueeStyle:'normal',marqueeW:1,marqueeH:1,selectionMode:0,
    magneticW:10,magneticContrast:10,magneticFreq:57,magneticPressure:false,
    tolerance:32,contiguous:true,sampleAll:false,
    bucketFill:'foreground',fillOpacity:100,
    gradientMode:'gradient',gradientStyle:'linear',gradientBlend:'normal',gradientReverse:false,gradientDither:true,
    cropRatio:'',cropW:0,cropH:0,cropDelete:true,cropOverlay:'thirds',cropOverlayShow:'auto',straighten:false,shieldClassic:false,shieldShow:true,shieldCenter:true,shieldOn:true,shieldOpacity:75,shieldAuto:true,
    spotType:'contentAware',
    removeNew:false,removeEach:true,
    patchKind:'normal',patchMode:'source',patchStructure:4,patchColor:0,
    camMode:'move',camStructure:4,camColor:0,camTransform:false,
    cloneAligned:true,cloneSample:'current',
    exposure:50,toneRange:'midtones',protectTones:true,
    strength:50,protectDetail:true,finger:false,vibrance:true,spongeMode:'desaturate',
    crMode:'color',crSampling:'continuous',crLimits:'contiguous',crTolerance:30,crAnti:true,
    bgSampling:'continuous',bgLimits:'contiguous',bgTolerance:50,bgProtect:false,
    magicOpacity:100,
    mixerWet:50,mixerLoad:50,mixerMix:50,mixerFlow:100,
    patternAligned:true,impressionist:false,patternScale:100,patternAngle:0,gradientPreset:'foreground',strokeAlign:'center',strokeCap:'butt',strokeJoin:'miter',strokeMiter:4,strokeOpacity:100,strokeDash:false,
    vectorMode:'path',strokeWidth:0,penAuto:true,curveFit:2,
    shapeFill:true,shapeRadius:0,polygonSides:5,lineWeight:3,
    frameEllipse:false,brushOpacity:100,brushFlow:100,brushSmooth:10,eraserMode:'brush',pencilAuto:false,showGrid:true,strokeStyle:'none',markerSize:4,labelSize:12,patternChoice:'checker',customShapeName:'Heart',resolutionUnit:'px/in',resolutionValue:72,
    typeFont:'Inter',typeStyle:'Regular',typeSize:48,typeAA:'sharp',typeAlign:'left',
    zoomScrubby:true,rotateAngle:0,
    eyedropperSize:'point',eyedropperSample:'all',eyedropperRing:true,
    objectFinder:true,enhanceEdge:false,
    pupil:50,darken:50,
    artboardPreset:'',artboardW:1,artboardH:1,
    noteAuthor:'',count:0
  });
  const sep=()=>{const n=document.createElement('span');n.className='opt-sep';return n;};
  const label=(text)=>{const n=document.createElement('span');bindText(n,text);return n;};
  const hint=(text,keys={})=>{const n=document.createElement('span');n.className='hint';const map={key:'⌥',alt:'⌥',shift:'⇧',del:'⌫',...keys};let value=t(text);for(const [k,v] of Object.entries(map))value=value.replaceAll('{'+k+'}',v);n.textContent=value;return n;};
  const icon=(name,tip,on,run)=>{const b=document.createElement('button');b.type='button';b.className='opt-icon'+(on?' on':'');b.title=t(tip);b.setAttribute('aria-label',t(tip));const img=document.createElement('img');img.src='icons/'+name+'.svg';img.alt='';b.append(img);b.onclick=run;return b;};
  const check=(text,key,disabled=false)=>{const lab=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=!!opt[key];input.disabled=disabled;input.onchange=()=>{opt[key]=input.checked;};const span=document.createElement('span');bindText(span,text);lab.append(input,span);return lab;};
  const field=(input,unit,width)=>{const wrap=document.createElement('span');wrap.className='opt-field';wrap.style.width=width+'px';wrap.append(input);if(unit)wrap.append(document.createTextNode(unit.trim()));return wrap;};
  const num=(key,min,max,unit='',width=62)=>{const input=document.createElement('input');input.className='opt-num';input.type='number';input.min=min;input.max=max;input.value=opt[key];input.onchange=()=>{opt[key]=Number(input.value);};return field(input,unit,width);};
  const pick=(key,pairs,width=96)=>{const sel=document.createElement('select');sel.style.width=width+'px';for(const [value,text] of pairs){const o=document.createElement('option');o.value=value;bindText(o,text);sel.append(o);}sel.value=opt[key];sel.onchange=()=>{opt[key]=sel.value;if(key==='typeStyle')command('panel.type.style',{style:sel.value});};return sel;};
  const button=(text,run)=>{const b=document.createElement('button');b.type='button';bindText(b,text);b.onclick=run;return b;};
  const exclusive=(key,value,text)=>{const lab=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=opt[key]===value;input.onchange=()=>{opt[key]=value;show(current);};const span=document.createElement('span');bindText(span,text);lab.append(input,span);return lab;};
  const modes=()=>{const wrap=document.createElement('span');wrap.style.display='inline-flex';wrap.style.gap='2px';
    [['square','New selection',0],['plus','Add to selection',1],['minus','Subtract from selection',2],['squares-subtract','Intersect with selection',3]].forEach(([name,tip,i])=>{wrap.append(icon(name,tip,opt.selectionMode===i,()=>{opt.selectionMode=i;show(current);}));});return wrap;};
  const chip=()=>{const size=document.querySelector('#brush-size');const b=document.createElement('button');b.type='button';b.className='chip';const tip=document.createElement('span');tip.className='chip-tip';const n=document.createElement('span');n.textContent=size?String(size.value):'20';const chev=document.createElement('img');chev.src='icons/chevron-down.svg';chev.alt='';b.append(tip,n,chev);b.title=t('Brush preset');b.onclick=()=>document.querySelector('[data-command="tool.brushPresets"]')?.click();return b;};
  const gear=()=>icon('sliders-horizontal','Brush Settings',false,()=>document.querySelector('[data-command="tool.brushSettings"]')?.click());
  const brushHead=()=>[chip(),gear(),sep()];
  let current='move';
  function show(tool){
    current=tool;
    bar.replaceChildren();
    const nodes=layout(tool);
    for(const node of nodes)if(node)bar.append(node);
  }
  function layout(tool){
    const alias={marquee:'rectMarquee',ellipse:'ellipseMarquee',magnetic:'magneticLasso',objectSelect:'objectSelection',quickSelect:'quickSelection',wand:'magicWand',clone:'cloneStamp',fill:'paintBucket',blurBrush:'blur',sharpenBrush:'sharpen',text:'type',direct:'directSelection'};
    tool=alias[tool]||tool;
    const marquee=['rectMarquee','ellipseMarquee','singleRowMarquee','singleColumnMarquee'];
    if(tool==='move')return moveBar();
    if(tool==='artboard'){const sizes={'iPhone 14':[390,844],'iPhone 14 Pro Max':[430,932],'Android 1080p':[360,640],'iPad Pro 12.9':[1024,1366],'Web 1280':[1280,800],'Web 1366':[1366,768],'Web 1920':[1920,1080],'Instagram Post':[1080,1080],Letter:[612,792],A4:[595,842]};const apply=()=>{const d=state.documents?.[state.index],layer=d?.layers?.find(item=>item.id===d.activeId);if(layer?.artboard&&d.resizeArtboard)d.resizeArtboard(layer,{x:layer.artboard.x,y:layer.artboard.y,w:opt.artboardW,h:opt.artboardH});};const preset=pick('artboardPreset',[['', 'Custom'],...Object.keys(sizes).map(name=>[name,name])],150);preset.onchange=()=>{opt.artboardPreset=preset.value;const size=sizes[preset.value];if(size){opt.artboardW=size[0];opt.artboardH=size[1];apply();}show(tool);};const bindSize=(key)=>{const wrap=num(key,1,300000,' px',64),field=wrap.querySelector('input');field.onchange=()=>{opt.artboardPreset='';opt[key]=Number(field.value);apply();};return wrap;};const w=bindSize('artboardW'),h=bindSize('artboardH');return [label('Size'),preset,label('W'),w,label('H'),h,button('Make Portrait',()=>{if(opt.artboardW>opt.artboardH){const n=opt.artboardW;opt.artboardW=opt.artboardH;opt.artboardH=n;apply();show(tool);}}),button('Make Landscape',()=>{if(opt.artboardH>opt.artboardW){const n=opt.artboardW;opt.artboardW=opt.artboardH;opt.artboardH=n;apply();show(tool);}}),sep(),button('Add New Artboard',()=>command('layer.new.artboard',{width:opt.artboardW,height:opt.artboardH}))];}
    if(marquee.includes(tool))return marqueeBar(tool);
    if(['lasso','polygonLasso','magneticLasso'].includes(tool))return lassoBar(tool);
    if(tool==='magicWand')return [modes(),sep(),label('Tolerance'),num('tolerance',0,255,'',58),check('Anti-alias','antiAlias'),check('Contiguous','contiguous'),check('Sample All Layers','sampleAll'),sep(),button('Select Subject',()=>command('select.subject',{})),button('Select and Mask…',()=>command('select.selectAndMask',{}))];
    if(tool==='objectSelection')return [check('Object Finder','objectFinder'),check('Sample All Layers','sampleAll'),hint('Drag a rectangle around the object'),sep(),button('Select Subject',()=>command('select.subject',{}))];
    if(tool==='quickSelection')return [...brushHead(),check('Sample All Layers','sampleAll'),check('Enhance Edge','enhanceEdge'),hint('{key} to subtract'),sep(),button('Select Subject',()=>command('select.subject',{}))];
    if(tool==='crop')return cropBar();
    if(tool==='perspectiveCrop')return [label('Width'),num('cropW',0,99999,'',64),label('Height'),num('cropH',0,99999,'',64),label('Resolution'),num('resolutionValue',1,9999,'',64),pick('resolutionUnit',[['px/in','px/in'],['px/cm','px/cm']],64),button('Front Image',()=>frontImage(tool)),button('Clear',()=>{opt.cropW=0;opt.cropH=0;opt.resolutionValue=0;show(tool);}),sep(),check('Show Grid','showGrid'),cropCommit()];
    if(tool==='slice')return [label('Style: Normal'),sep(),button('Slices From Guides',()=>command('slice.fromGuides',{}))];
    if(tool==='sliceSelect')return [button('Promote',()=>command('slice.promote',{})),button('Divide…',()=>command('slice.divide',{})),button('Delete',()=>command('slice.delete',{})),sep(),check('Hide Auto Slices','sampleAll'),sep(),button('Slice Options…',()=>command('slice.options',{}))];
    if(tool==='frame')return [icon('square','Create a new rectangular frame',!opt.frameEllipse,()=>{opt.frameEllipse=false;show(tool);}),icon('circle','Create a new elliptical frame',opt.frameEllipse,()=>{opt.frameEllipse=true;show(tool);})];
    if(tool==='eyedropper')return [label('Sample Size:'),pick('eyedropperSize',[['point','Point Sample'],['3','3 by 3 Average'],['5','5 by 5 Average'],['11','11 by 11 Average'],['31','31 by 31 Average'],['51','51 by 51 Average'],['101','101 by 101 Average']],130),label('Sample:'),pick('eyedropperSample',[['current','Current Layer'],['currentAndBelow','Current & Below'],['all','All Layers'],['allNoAdjustments','All Layers No Adjustments'],['currentAndBelowNoAdjustments','Current & Below No Adjustments']],190),check('Show Sampling Ring','eyedropperRing'),sep(),hint('Click to sample the foreground colour  ·  {key}-click for background')];
    if(tool==='colorSampler'){const d=state.documents?.[state.index],n=d?.colorSamplers?.length||0;return [hint(t('{n} of {max} sample points').replaceAll('{n}',String(n)).replaceAll('{max}','10')),sep(),button('Clear All',()=>{document.querySelector('#sampler-tool-options button')?.click();show(tool);}),sep(),hint('Click to place · Alt-click or drag off-canvas to remove')];}
    if(tool==='ruler'){const r=state.documents?.[state.index]?.ruler,round=n=>Math.round(n*100)/100;const dx=r?r.end.x-r.start.x:null,dy=r?r.end.y-r.start.y:null,text=name=>label(name+': '+(r?round(name==='X'?r.start.x:name==='Y'?r.start.y:name==='W'?dx:name==='H'?dy:name==='A'?Math.atan2(-dy,dx)*180/Math.PI:name==='L1'?Math.hypot(dx,dy):r.protractor?Math.hypot(r.protractor.x-r.start.x,r.protractor.y-r.start.y):'—'):'—'));return [text('X'),text('Y'),text('W'),text('H'),text('A'),text('L1'),text('L2'),sep(),check('Use Measurement Scale','sampleAll'),button('Straighten Layer',()=>command('image.analysis.straightenLayer',{})),button('Clear',()=>{document.querySelector('#ruler-tool-options button')?.click();show(tool);})];}
    if(tool==='note'){const color=swatch();color.style.background='#ffff82';const author=textField('noteAuthor',120);author.oninput=()=>{opt.noteAuthor=author.value;const d=state.documents?.[state.index];if(d)d.noteAuthor=author.value;};return [label('Author:'),author,label('Color:'),color,button('Clear All',()=>{state.documents?.[state.index]?.deleteAllNotes?.();show(tool);}),icon('message-square','Show or hide the Notes panel',false,()=>command('window.panel.info',{}))];}
    if(tool==='count'){const d=state.documents?.[state.index],n=d?.countGroups?.reduce((sum,group)=>sum+(group.points?.length||0),0)||0,nodes=[hint(t('Count: {n}').replaceAll('{n}',String(n))),icon('folder-plus','Create a new count group',false,()=>command('panel.count.new',{})),button('Clear',()=>command('panel.count.clear',{}))];if(d?.countGroups?.length)nodes.push(label('Marker Size'),num('markerSize',1,50,'',40),label('Label Size'),num('labelSize',6,72,'',44));return nodes;}
    if(tool==='brush')return brushBar(false);
    if(tool==='eraser')return brushBar(true);
    if(tool==='pencil')return [chip(),gear(),sep(),label('Mode'),blendMode(),label('Opacity'),percent('brushOpacity'),label('Smoothing'),num('brushSmooth',0,100,'%',58),sep(),check('Auto Erase','pencilAuto'),...symmetryControl()];
    if(tool==='mixerBrush')return [...brushHead(),label('Wet'),percent('mixerWet'),label('Load'),percent('mixerLoad'),label('Mix'),percent('mixerMix'),label('Flow'),percent('mixerFlow'),sep(),check('Sample All Layers','sampleAll')];
    if(tool==='colorReplacement')return [...brushHead(),label('Mode:'),pick('crMode',[['hue','Hue'],['saturation','Saturation'],['color','Color'],['luminosity','Luminosity']],100),sep(),...sampling('crSampling'),sep(),label('Limits:'),pick('crLimits',[['discontiguous','Discontiguous'],['contiguous','Contiguous'],['findEdges','Find Edges']],110),label('Tolerance:'),percent('crTolerance'),check('Anti-alias','crAnti')];
    if(tool==='backgroundEraser')return [...brushHead(),...sampling('bgSampling'),sep(),label('Limits:'),pick('bgLimits',[['discontiguous','Discontiguous'],['contiguous','Contiguous'],['findEdges','Find Edges']],110),label('Tolerance:'),percent('bgTolerance'),check('Protect Foreground Color','bgProtect')];
    if(tool==='magicEraser')return [label('Tolerance:'),num('tolerance',0,255,'',58),check('Anti-alias','antiAlias'),check('Contiguous','contiguous'),check('Sample All Layers','sampleAll'),sep(),label('Opacity:'),percent('magicOpacity')];
    if(tool==='gradient')return gradientBar();
    if(tool==='paintBucket')return [label('Fill'),pick('bucketFill',[['foreground','Foreground'],['pattern','Pattern']],100),label('Opacity'),percent('fillOpacity'),label('Tolerance'),num('tolerance',0,255,'',58),check('Anti-alias','antiAlias'),check('Contiguous','contiguous'),check('All Layers','sampleAll')];
    if(tool==='remove')return [...brushHead(),check('Sample All Layers','sampleAll'),check('Create a new layer','removeNew'),check('Remove after each stroke','removeEach')];
    if(tool==='spotHealing')return [...brushHead(),label('Type:'),...['contentAware','Content-Aware','createTexture','Create Texture','proximityMatch','Proximity Match'].reduce((nodes,item,index,list)=>index%2?nodes:(nodes.push(exclusive('spotType',list[index],list[index+1])),nodes),[]),sep(),check('Sample All Layers','sampleAll')];
    if(tool==='healing')return [...brushHead(),check('Aligned','cloneAligned'),label('Sample:'),pick('cloneSample',[['current','Current Layer'],['currentAndBelow','Current & Below'],['all','All Layers']],130),sep(),hint('{key}-click to set the source')];
    if(tool==='cloneStamp')return [...brushHead(),label('Opacity'),percent('brushOpacity'),label('Flow'),percent('brushFlow'),sep(),check('Aligned','cloneAligned'),label('Sample:'),pick('cloneSample',[['current','Current Layer'],['currentAndBelow','Current & Below'],['all','All Layers']],130),sep(),hint('{key}-click to set the source')];
    if(tool==='patternStamp'){const patterns=[['checker','Checkerboard'],['diagonal','Diagonal Lines'],['dots','Dots'],['grid','Grid'],['bricks','Bricks'],['weave','Weave'],['paper','Paper Noise']];const pattern=pick('patternChoice',patterns,140);pattern.onchange=()=>{opt.patternChoice=pattern.value;if(state.patternStamp)state.patternStamp.pattern=pattern.value;};return [...brushHead(),check('Aligned','patternAligned'),check('Impressionist','impressionist'),sep(),label('Pattern'),pattern,label('Scale'),percent('patternScale',58),label('Angle:'),num('patternAngle',-180,180,'°',58)];}
    if(tool==='historyBrush')return [...brushHead(),hint("Paints from the document's opening state")];
    if(tool==='patch')return patchBar();
    if(tool==='contentAwareMove')return [label('Mode:'),pick('camMode',[['move','Move'],['extend','Extend']],90),label('Structure:'),num('camStructure',1,7,'',40),label('Color:'),num('camColor',0,10,'',40),check('Sample All Layers','sampleAll'),check('Transform On Drop','camTransform'),sep(),hint('Lasso around an area, then drag the selection')];
    if(tool==='redEye')return [label('Pupil Size'),num('pupil',1,100,'',50),label('Darken Amount'),num('darken',0,100,'',50),sep(),hint('Click a red pupil to neutralize it')];
    if(tool==='dodge'||tool==='burn')return [...brushHead(),label('Range:'),pick('toneRange',[['shadows','Shadows'],['midtones','Midtones'],['highlights','Highlights']],100),label('Exposure:'),percent('exposure',58),check('Protect Tones','protectTones')];
    if(tool==='sponge')return [...brushHead(),label('Mode:'),pick('spongeMode',[['desaturate','Desaturate'],['saturate','Saturate']],110),check('Vibrance','vibrance')];
    if(tool==='blur'||tool==='sharpen'||tool==='smudge')return [...brushHead(),label('Strength:'),percent('strength',58),check('Sample All Layers','sampleAll'),tool==='sharpen'?check('Protect Detail','protectDetail'):null,tool==='smudge'?check('Finger Painting','finger'):null];
    if(['pen','freeformPen','curvaturePen'].includes(tool))return penBar(tool);
    if(tool==='addAnchorPoint')return [hint('Click a segment to add an anchor point · {alt}-click an anchor to delete it')];
    if(tool==='deleteAnchorPoint')return [hint('Click an anchor point to delete it · {alt}-click a segment to add one')];
    if(tool==='convertPoint')return [];
    if(tool==='pathSelection')return [hint("Drag to move the active shape's path or the Work Path")];
    if(tool==='directSelection')return [hint('Click: select anchor · Drag: move anchor, handle or segment · {shift}-click: add · {alt}-click: whole subpath')];
    if(['rectangle','ellipseShape','triangle','polygon','line','customShape'].includes(tool))return shapeBar(tool);
    if(['type','verticalType','horizontalTypeMask','verticalTypeMask'].includes(tool))return typeBar();
    if(tool==='hand')return [hint('Drag to pan  ·  hold Space with any tool'),button('100%',()=>document.querySelector('#actual')?.click()),button('Fit Screen',()=>document.querySelector('#fit')?.click()),button('Fill Screen',()=>document.querySelector('#fill-screen')?.click())];
    if(tool==='zoom')return [check('Scrubby Zoom','zoomScrubby'),hint('Click to zoom in  ·  {key}-click to zoom out  ·  drag right/left to zoom in/out'),button('Fit Screen',()=>document.querySelector('#fit')?.click()),button('100%',()=>document.querySelector('#actual')?.click())];
    if(tool==='rotateView')return [hint('Drag around the centre to rotate the view  ·  Shift constrains to 15°'),label('Angle'),num('rotateAngle',-180,180,'°',56),button('Reset View',()=>{opt.rotateAngle=0;show(tool);})];
    return [];
  }
  function percent(key,width=62){const input=document.createElement('input');input.className='opt-num';input.type='number';input.min=0;input.max=100;input.value=opt[key];input.onchange=()=>{opt[key]=Number(input.value);const brush=document.querySelector('#brush-opacity');if(brush&&(key==='fillOpacity'||key==='magicOpacity')){brush.value=input.value;brush.dispatchEvent(new Event('input',{bubbles:true}));}};return field(input,'%',width);}
  function textField(key,width){const input=document.createElement('input');input.style.width=width+'px';input.value=opt[key]||'';input.oninput=()=>{opt[key]=input.value;};return input;}
  function swatch(){const b=document.createElement('button');b.type='button';b.className='swatch';b.style.background=document.querySelector('#foreground')?.value||'#000';b.onclick=()=>document.querySelector('#foreground')?.click();return b;}
  function blendMode(){return pick('gradientBlend',[['normal','Normal'],['dissolve','Dissolve'],['darken','Darken'],['multiply','Multiply'],['colorBurn','Color Burn'],['linearBurn','Linear Burn'],['darkerColor','Darker Color'],['lighten','Lighten'],['screen','Screen'],['colorDodge','Color Dodge'],['linearDodge','Linear Dodge (Add)'],['lighterColor','Lighter Color'],['overlay','Overlay'],['softLight','Soft Light'],['hardLight','Hard Light'],['vividLight','Vivid Light'],['linearLight','Linear Light'],['pinLight','Pin Light'],['hardMix','Hard Mix'],['difference','Difference'],['exclusion','Exclusion'],['subtract','Subtract'],['divide','Divide'],['hue','Hue'],['saturation','Saturation'],['color','Color'],['luminosity','Luminosity']],110);}
  function sampling(key){return [['continuous','pipette','Sampling: Continuous'],['once','circle-dot','Sampling: Once'],['backgroundSwatch','square','Sampling: Background Swatch']].map(([value,name,tip])=>icon(name,tip,opt[key]===value,()=>{opt[key]=value;show(current);}));}
  function moveBar(){
    const more=icon('ellipsis','Align and distribute',false,event=>{event.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden){const r=more.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=(r.bottom+4)+'px';}});
    const menu=document.createElement('div');menu.className='menu-popup crop-option-popup';menu.hidden=true;
    const section=(title,rows)=>{const h=document.createElement('div');h.textContent=t(title);menu.append(h);for(const [text,id] of rows){const item=document.createElement('button');item.type='button';bindText(item,text);item.onclick=()=>{menu.hidden=true;command(id,{});};menu.append(item);}};
    section('Align',[['Top Edges','align.topEdges'],['Vertical Centers','align.verticalCenters'],['Bottom Edges','align.bottomEdges'],['Left Edges','align.leftEdges'],['Horizontal Centers','align.horizontalCenters'],['Right Edges','align.rightEdges']]);
    section('Distribute',[['Top Edges','align.distributeTop'],['Vertical Centers','align.distributeVCenter'],['Bottom Edges','align.distributeBottom'],['Left Edges','align.distributeLeft'],['Horizontal Centers','align.distributeHCenter'],['Right Edges','align.distributeRight'],['Horizontally','align.distributeH'],['Vertically','align.distributeV']]);
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==more)menu.hidden=true;});
    const pack=document.createElement('span');pack.className='align-pack';const space=document.createElement('span');space.style.cssText='width:6px;flex:0 0 6px';pack.append(icon('panels-top-left','Align left edges',false,()=>command('align.left',{})),icon('app-window','Align horizontal centers',false,()=>command('align.centerH',{})),icon('panel-right','Align right edges',false,()=>command('align.right',{})),space,more);return [check('Auto-Select:','moveAuto'),pick('moveTarget',[['layer','Layer'],['group','Group']],76),sep(),check('Show Transform Controls','moveTransform'),sep(),pack,menu];
  }
  function marqueeBar(tool){
    const sized=tool==='rectMarquee'||tool==='ellipseMarquee';
    const style=pick('marqueeStyle',[['normal','Normal'],['fixedRatio','Fixed Ratio'],['fixedSize','Fixed Size']],96);
    style.disabled=!sized;
    const fixed=sized&&opt.marqueeStyle!=='normal';
    const w=num('marqueeW',fixed&&opt.marqueeStyle==='fixedSize'?1:0.001,300000);const h=num('marqueeH',fixed&&opt.marqueeStyle==='fixedSize'?1:0.001,300000);
    if(w.disabled!=null){w.disabled=!fixed;}
    const width=w.tagName==='INPUT'?w:w.querySelector('input');const height=h.tagName==='INPUT'?h:h.querySelector('input');
    if(width)width.disabled=!fixed;if(height)height.disabled=!fixed;
    const swap=icon('arrow-left-right','Swaps height and width',false,()=>{const a=opt.marqueeW;opt.marqueeW=opt.marqueeH;opt.marqueeH=a;show(tool);});
    swap.disabled=!fixed;
    style.onchange=()=>{opt.marqueeStyle=style.value;if(style.value==='fixedSize'){opt.marqueeW=64;opt.marqueeH=64;}else{opt.marqueeW=1;opt.marqueeH=1;}show(tool);};
    return [modes(),sep(),label('Feather'),num('feather',0,1000,' px'),check('Anti-alias','antiAlias',tool!=='ellipseMarquee'),sep(),label('Style'),style,label('Width'),w,swap,label('Height'),h,sep(),button('Select and Mask…',()=>command('select.selectAndMask',{}))];
  }
  function lassoBar(tool){
    const nodes=[modes(),sep(),label('Feather'),num('feather',0,1000,' px'),check('Anti-alias','antiAlias'),sep()];
    if(tool==='magneticLasso')nodes.push(label('Width'),num('magneticW',1,256,' px',58),label('Contrast'),num('magneticContrast',1,100,' %',58),label('Frequency'),num('magneticFreq',0,100,'',50),icon('circle-dot','Use tablet pressure to change pen width',opt.magneticPressure,()=>{opt.magneticPressure=!opt.magneticPressure;show(current);}),sep());
    nodes.push(button('Select and Mask…',()=>command('select.selectAndMask',{})));
    if(tool==='lasso')nodes.push(hint('Hold Alt while drawing for straight segments'));
    return nodes;
  }
  function symmetryControl(){
    const symmetry=icon('painting-symmetry','Set painting symmetry options',state.brush?.symmetry&&state.brush.symmetry!=='none',event=>{event.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden){const r=symmetry.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=(r.bottom+4)+'px';}});
    const menu=document.createElement('div');menu.className='menu-popup crop-option-popup';menu.hidden=true;
    for(const [value,text] of [['none','Symmetry Off'],['vertical','Vertical'],['horizontal','Horizontal'],['dual','Dual Axis'],['radial','Radial']]){const item=document.createElement('button');item.type='button';bindText(item,text);item.onclick=()=>{menu.hidden=true;if(state.brush)state.brush.symmetry=value;show(current);};menu.append(item);}
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==symmetry)menu.hidden=true;});
    return [symmetry,menu];
  }
  function lock(node,off){if(!node)return node;if(node.matches?.('input,select,button'))node.disabled=off;node.querySelectorAll?.('input,select,button').forEach(el=>{el.disabled=off;});return node;}
  function brushBar(eraser){
    const mode=eraser?pick('eraserMode',[['brush','Brush'],['pencil','Pencil'],['block','Block']],90):blendMode();
    if(eraser)mode.onchange=()=>{opt.eraserMode=mode.value;state.eraserMode=mode.value;show(current);};
    const block=eraser&&opt.eraserMode==='block';
    const pencil=eraser&&opt.eraserMode==='pencil';
    const opacity=percent('brushOpacity');
    const opacityPressure=icon('circle-dot','Always use pressure for opacity',!!state.brush?.opacityPressure,()=>{if(state.brush)state.brush.opacityPressure=!state.brush.opacityPressure;show(current);});
    const flow=percent('brushFlow');
    const air=icon('sparkles','Enable airbrush-style build-up effects',!!state.brush?.buildUp,()=>{if(state.brush)state.brush.buildUp=!state.brush.buildUp;show(current);});
    const smooth=icon('settings','Set additional smoothing options',false,()=>{});
    const smoothMenu=attachMenu(smooth,menu=>{for(const [key,text,fallback] of [['pulledString','Pulled String Mode',false],['catchUp','Stroke Catch-up',true],['catchUpOnEnd','Catch-up on Stroke End',true],['adjustForZoom','Adjust for Zoom',true]]){const lab=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=state.brush?state.brush[key]!==undefined?!!state.brush[key]:fallback:fallback;input.onchange=()=>{if(state.brush)state.brush[key]=input.checked;};const span=document.createElement('span');bindText(span,text);lab.append(input,span);menu.append(lab);}});
    return [lock(chip(),block),lock(gear(),block),sep(),label('Mode'),mode,label('Opacity'),lock(opacity,block),lock(opacityPressure,block),label('Flow'),lock(flow,block||pencil),lock(air,block||pencil),label('Smoothing'),num('brushSmooth',0,100,'%',58),lock(smooth,false),smoothMenu,sep(),icon('circle-dot','Always use pressure for size',!!state.brush?.sizePressure,()=>{if(state.brush)state.brush.sizePressure=!state.brush.sizePressure;show(current);}),...symmetryControl()];
  }
  function attachMenu(anchor,fill){const menu=document.createElement('div');menu.className='menu-popup crop-option-popup';menu.hidden=true;fill(menu,()=>{menu.hidden=true;});anchor.onclick=event=>{event.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden){const r=anchor.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=(r.bottom+4)+'px';}};document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==anchor)menu.hidden=true;});return menu;}
  function gradientBar(){
    const styles=[['linear','gradient','Linear Gradient'],['radial','circle','Radial Gradient'],['angle','rotate-cw','Angle Gradient'],['reflected','arrow-left-right','Reflected Gradient'],['diamond','diamond','Diamond Gradient']].map(([value,name,tip])=>icon(name,tip,opt.gradientStyle===value,()=>{opt.gradientStyle=value;show(current);}));
    const fg=document.querySelector('#foreground')?.value||'#000',bg=document.querySelector('#background')?.value||'#fff';
    const paint=opt.gradientPreset==='transparent'?`linear-gradient(90deg,${fg},transparent),repeating-conic-gradient(#888 0% 25%,#222 0% 50%) 0 0/8px 8px`:opt.gradientPreset==='blackWhite'?'linear-gradient(90deg,#000,#fff)':`linear-gradient(90deg,${fg},${bg})`;
    const ramp=document.createElement('button');ramp.type='button';ramp.className='swatch';ramp.style.width='70px';ramp.style.background=paint;ramp.title=t('Gradient');
    const rampMenu=attachMenu(ramp,menu=>{for(const [value,text] of [['foreground','Foreground to Background'],['transparent','Foreground to Transparent'],['blackWhite','Black, White']]){const item=document.createElement('button');item.type='button';bindText(item,text);item.onclick=()=>{opt.gradientPreset=value;menu.hidden=true;show(current);};menu.append(item);}});
    return [pick('gradientMode',[['gradient','Gradient'],['classic','Classic gradient']],118),ramp,rampMenu,sep(),...styles,sep(),label('Mode'),blendMode(),label('Opacity'),percent('fillOpacity'),check('Reverse','gradientReverse'),check('Dither','gradientDither')];
  }
  function cropBar(){
    const saved=(state.cropPresets||[]).map(item=>['user:'+item.name,item.name]);
    const ratio=pick('cropRatio',[['', 'Ratio'],['whr','W x H x Resolution'],['original','Original Ratio'],['1:1','1 : 1 (Square)'],['4:5','4 : 5 (8 : 10)'],['5:7','5 : 7'],['2:3','2 : 3 (4 : 6)'],['16:9','16 : 9'],['preset:4x5in','4 x 5 in 300 ppi'],['preset:8.5x11in','8.5 x 11 in 300 ppi'],['preset:1024x768px','1024 x 768 px 92 ppi'],['preset:1280x800px','1280 x 800 px 113 ppi'],['preset:1366x768px','1366 x 768 px 135 ppi'],['preset:4x6in','4 x 6 in 300 ppi'],['preset:5x7in','5 x 7 in 300 ppi'],['preset:8x10in','8 x 10 in 300 ppi'],...saved,['front','Front Image'],['new','New Crop Preset…'],['delete','Delete Crop Preset…']],140);
    ratio.onchange=()=>{const value=ratio.value;if(value==='front'){frontImage(current);return;}if(value==='new'){ratio.value=opt.cropRatio;newCropPreset();return;}if(value==='delete'){ratio.value=opt.cropRatio;deleteCropPreset();return;}if(value.startsWith('user:')){const item=(state.cropPresets||[]).find(preset=>preset.name===value.slice(5));if(item){opt.cropRatio=item.ratio;opt.cropW=item.w;opt.cropH=item.h;opt.resolutionValue=item.res;opt.resolutionUnit=item.unit;}show(current);return;}const presets={'preset:4x5in':[4,5,300],'preset:8.5x11in':[8.5,11,300],'preset:1024x768px':[1024,768,92],'preset:1280x800px':[1280,800,113],'preset:1366x768px':[1366,768,135],'preset:4x6in':[4,6,300],'preset:5x7in':[5,7,300],'preset:8x10in':[8,10,300]};if(presets[value]){opt.cropRatio='whr';opt.cropW=presets[value][0];opt.cropH=presets[value][1];opt.resolutionValue=presets[value][2];opt.resolutionUnit='px/in';}else opt.cropRatio=value;show(current);};
    const straighten=icon('ruler','Straighten the image by drawing a line on it',opt.straighten,()=>{opt.straighten=!opt.straighten;state.cropStraighten=opt.straighten;});
    const overlay=icon('grid-3x3','Set the overlay options for the Crop tool',false,()=>{});
    const shield=icon('settings','Set additional Crop options',false,()=>{});
    const mark=(on,text)=> (on?'✔ ':'  ')+t(text);
    const overlayMenu=attachMenu(overlay,menu=>{const item=(on,text,run)=>{const b=document.createElement('button');b.type='button';b.textContent=mark(on,text);b.onclick=()=>{run();menu.hidden=true;show(current);};menu.append(b);};for(const [value,text] of [['thirds','Rule of Thirds'],['grid','Grid'],['diagonal','Diagonal'],['triangle','Triangle'],['goldenRatio','Golden Ratio'],['goldenSpiral','Golden Spiral']])item(opt.cropOverlay===value,text,()=>{if(opt.cropOverlay!==value)opt.cropOverlayOrientation=0;opt.cropOverlay=value;});menu.append(sep());for(const [value,text] of [['auto','Auto Show Overlay'],['always','Always Show Overlay'],['never','Never Show Overlay']])item(opt.cropOverlayShow===value,text,()=>{opt.cropOverlayShow=value;});menu.append(sep());item(false,'Cycle Overlay',()=>{const order=['thirds','grid','diagonal','triangle','goldenRatio','goldenSpiral'];opt.cropOverlay=order[(order.indexOf(opt.cropOverlay)+1)%order.length];});});
    const shieldMenu=attachMenu(shield,menu=>{const row=(key,text)=>{const lab=check(text,key);lab.querySelector('input').onchange=()=>{opt[key]=lab.querySelector('input').checked;};menu.append(lab);};row('shieldClassic','Use Classic Mode');row('shieldShow','Show Cropped Area');row('shieldCenter','Auto Center Preview');menu.append(sep());row('shieldOn','Enable Crop Shield');menu.append(label('Opacity:'));const opacity=num('shieldOpacity',0,100,' %');menu.append(opacity);row('shieldAuto','Auto Adjust Opacity');});
    const cropField=opt.cropRatio==='whr'?64:54;
    return [ratio,num('cropW',0,99999,'',cropField),icon('arrow-left-right','Swaps height and width',false,()=>{const a=opt.cropW;opt.cropW=opt.cropH;opt.cropH=a;show(current);}),num('cropH',0,99999,'',cropField),sep(),button('Clear',()=>{opt.cropW=0;opt.cropH=0;show(current);}),straighten,overlay,overlayMenu,shield,shieldMenu,check('Delete Cropped Pixels','cropDelete'),cropCommit()];
  }
  function cropCommit(){const wrap=document.createElement('span');wrap.className='crop-commit';wrap.append(icon('check','Commit current crop operation',false,()=>command('image.crop',{})),icon('ban','Cancel current crop operation',false,()=>{const d=state.documents?.[state.index];if(d)d.selection=null;opt.straighten=false;state.cropStraighten=false;state.cropAngle=0;show(current);}));return wrap;}
  function patchBar(){
    const kind=pick('patchKind',[['normal','Normal'],['contentAware','Content-Aware']],120);
    kind.onchange=()=>{opt.patchKind=kind.value;show(current);};
    const rest=opt.patchKind==='contentAware'?[label('Structure:'),num('patchStructure',1,7,'',40),label('Color:'),num('patchColor',0,10,'',40),check('Sample All Layers','sampleAll')]:[exclusive('patchMode','source','Source'),exclusive('patchMode','destination','Destination')];
    return [label('Patch:'),kind,...rest,sep(),hint('Lasso around an area, then drag the selection')];
  }
  function penBar(tool){
    const mode=pick('vectorMode',[['path','Path'],['shape','Shape']],80);
    mode.onchange=()=>{opt.vectorMode=mode.value;show(tool);};
    const nodes=[mode,sep()];
    if(opt.vectorMode==='shape')nodes.push(num('strokeWidth',0,288,' px',58));
    if(tool==='pen')nodes.push(sep(),check('Auto Add/Delete','penAuto'));
    if(tool==='freeformPen')nodes.push(sep(),label('Curve Fit:'),num('curveFit',0.5,10,' px',58),hint('Drag: draw freehand · {alt}-click: straight segment · Release on the start point: close'));
    else if(tool==='curvaturePen')nodes.push(hint('Click: smooth point · Double-click: corner · Drag a point: move · Click first point: close · {key} finish',{key:'Enter'}));
    else nodes.push(hint('Click: corner · Drag: smooth · {alt}-drag: break handle · Click or drag first point: close · {key} finish · Esc cancel',{key:'Enter'}));
    return nodes;
  }
  function frontImage(tool){const d=state.documents?.[state.index];if(!d)return;opt.cropRatio='whr';opt.cropW=d.width;opt.cropH=d.height;const dpi=d.resolution||72;opt.resolutionValue=opt.resolutionUnit==='px/cm'?Math.round(dpi/2.54*100)/100:dpi;show(tool||current);}
  function presetDialog(title,build){const back=document.createElement('div');back.style.cssText='position:fixed;inset:0;background:#0008;z-index:400;display:grid;place-items:center';const card=document.createElement('form');card.style.cssText='background:#2c2c2c;color:#eee;padding:16px;min-width:300px;display:grid;gap:8px';const heading=document.createElement('strong');bindText(heading,title);card.append(heading);build(card,()=>back.remove());back.append(card);document.body.append(back);}
  function newCropPreset(){const name0=opt.cropW&&opt.cropH?opt.cropW+' x '+opt.cropH:'';if(!name0&&!opt.cropRatio)return;presetDialog('New Crop Preset',(card,close)=>{const input=document.createElement('input');input.value=name0;const ok=document.createElement('button');ok.type='button';bindText(ok,'OK');ok.onclick=()=>{const name=input.value.trim().slice(0,80);if(!name)return;state.cropPresets=(state.cropPresets||[]).filter(item=>item.name!==name);state.cropPresets.push({name,ratio:opt.cropRatio,w:opt.cropW,h:opt.cropH,res:opt.resolutionValue,unit:opt.resolutionUnit});close();show(current);};const cancel=document.createElement('button');cancel.type='button';bindText(cancel,'Cancel');cancel.onclick=close;card.append(input,ok,cancel);});}
  function deleteCropPreset(){const items=state.cropPresets||[];if(!items.length)return;presetDialog('Delete Crop Preset',(card,close)=>{const boxes=items.map(item=>{const lab=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=item.name;const span=document.createElement('span');span.textContent=item.name;lab.append(input,span);card.append(lab);return input;});const ok=document.createElement('button');ok.type='button';bindText(ok,'OK');ok.onclick=()=>{const drop=new Set(boxes.filter(box=>box.checked).map(box=>box.value));state.cropPresets=items.filter(item=>!drop.has(item.name));close();show(current);};const cancel=document.createElement('button');cancel.type='button';bindText(cancel,'Cancel');cancel.onclick=close;card.append(ok,cancel);});}
  function strokeSample(style){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 54 16');svg.setAttribute('width','54');svg.setAttribute('height','16');
    const line=(x1,y1,x2,y2,stroke,width)=>{const n=document.createElementNS(svg.namespaceURI,'line');n.setAttribute('x1',x1);n.setAttribute('y1',y1);n.setAttribute('x2',x2);n.setAttribute('y2',y2);n.setAttribute('stroke',stroke);n.setAttribute('stroke-width',width);n.setAttribute('vector-effect','non-scaling-stroke');return n;};
    if(style==='none'){svg.append(line(0,8,54,8,'#8a8a8a',1),line(23,14,31,2,'#e23',1.5));}
    else{const n=line(0,8,54,8,'#e6e6e6',style==='dotted'?2.5:1.5);if(style==='dashed')n.setAttribute('stroke-dasharray','7 4');if(style==='dotted'){n.setAttribute('stroke-dasharray','0 5');n.setAttribute('stroke-linecap','round');}svg.append(n);}
    return svg;
  }
  function styleButton(){
    const names=[['none','No Color'],['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']];
    const b=document.createElement('button');b.type='button';b.className='stroke-style';b.title=t('Stroke Options');
    const text=document.createElement('span');bindText(text,names.find(item=>item[0]===opt.strokeStyle)?.[1]||'No Color');
    const chev=document.createElement('img');chev.src='icons/chevron-down.svg';chev.alt='';
    b.append(text,strokeSample(opt.strokeStyle),chev);
    const menu=document.createElement('div');menu.className='menu-popup crop-option-popup';menu.hidden=true;menu.style.minWidth='272px';menu.style.padding='8px';
    const heading=document.createElement('strong');bindText(heading,'Stroke Options');menu.append(heading);
    for(const [value,name] of names){const item=document.createElement('button');item.type='button';const span=document.createElement('span');bindText(span,name);item.append(span,strokeSample(value));item.onclick=()=>{opt.strokeStyle=value;if(value==='none')opt.strokeWidth=0;else if(opt.strokeWidth<=0)opt.strokeWidth=3;if(value==='dashed')opt.strokeDash=true;if(value==='solid')opt.strokeDash=false;show(current);};menu.append(item);}
    const choice=(key,labelText,pairs)=>{const row=document.createElement('label');const span=document.createElement('span');bindText(span,labelText);const sel=document.createElement('select');for(const [value,name] of pairs){const o=document.createElement('option');o.value=value;bindText(o,name);sel.append(o);}sel.value=opt[key];sel.onchange=()=>{opt[key]=sel.value;};row.append(span,sel);return row;};
    menu.append(choice('strokeAlign','Alignment',[['inside','Inside'],['center','Center'],['outside','Outside']]),choice('strokeCap','Caps',[['butt','Butt / Flat'],['round','Round'],['square','Square']]),choice('strokeJoin','Corners',[['miter','Miter'],['round','Round'],['bevel','Bevel']]));
    const miter=document.createElement('label');const miterText=document.createElement('span');bindText(miterText,'Miter limit');const miterInput=document.createElement('input');miterInput.type='number';miterInput.min='1';miterInput.max='500';miterInput.value=opt.strokeMiter;miterInput.onchange=()=>{opt.strokeMiter=Number(miterInput.value);};miter.append(miterText,miterInput);menu.append(miter);
    const opacity=document.createElement('label');const opacityText=document.createElement('span');bindText(opacityText,'Opacity');const opacityInput=document.createElement('input');opacityInput.type='number';opacityInput.min='0';opacityInput.max='100';opacityInput.value=opt.strokeOpacity;opacityInput.onchange=()=>{opt.strokeOpacity=Number(opacityInput.value);};opacity.append(opacityText,opacityInput);menu.append(opacity);
    const dashed=check('Dashed line','strokeDash');menu.append(dashed);
    b.onclick=event=>{event.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden){const r=b.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=(r.bottom+4)+'px';}};
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==b)menu.hidden=true;});
    return [b,menu];
  }
  function shapeGlyph(name){
    const paths={Heart:'M 50 92 C 20 70 0 52 0 30 C 0 12 14 0 28 0 C 40 0 47 8 50 16 C 53 8 60 0 72 0 C 86 0 100 12 100 30 C 100 52 80 70 50 92 Z',Star:'M50 4 L61 36 L96 36 L68 56 L78 90 L50 70 L22 90 L32 56 L4 36 L39 36 Z','Six-Point Star':'M50 2 L58 34 L92 18 L66 46 L98 58 L66 66 L86 98 L50 76 L14 98 L34 66 L2 58 L34 46 L8 18 L42 34 Z',Burst:'M50 8 L54 28 L72 12 L62 32 L88 28 L68 42 L92 52 L66 56 L84 74 L58 64 L62 88 L50 68 L38 88 L42 64 L16 74 L34 56 L8 52 L32 42 L12 28 L38 32 L28 12 L46 28 Z','Check Mark':'M 5 55 L 20 40 L 38 58 L 82 12 L 97 27 L 38 88 Z',Cross:'M 20 5 L 50 35 L 80 5 L 95 20 L 65 50 L 95 80 L 80 95 L 50 65 L 20 95 L 5 80 L 35 50 L 5 20 Z',Plus:'M 38 0 L 62 0 L 62 38 L 100 38 L 100 62 L 62 62 L 62 100 L 38 100 L 38 62 L 0 62 L 0 38 L 38 38 Z',Ring:'M50 8 A42 42 0 1 0 50 92 A42 42 0 1 0 50 8 M50 28 A22 22 0 1 1 50 72 A22 22 0 1 1 50 28',Lightning:'M 58 0 L 18 56 L 44 56 L 34 100 L 82 38 L 55 38 L 70 0 Z',Diamond:'M 50 0 L 90 50 L 50 100 L 10 50 Z','Arrow Right':'M 0 35 L 55 35 L 55 15 L 100 50 L 55 85 L 55 65 L 0 65 Z','Arrow Left':'M 100 35 L 45 35 L 45 15 L 0 50 L 45 85 L 45 65 L 100 65 Z','Arrow Up':'M 35 100 L 35 45 L 15 45 L 50 0 L 85 45 L 65 45 L 65 100 Z','Arrow Down':'M 35 0 L 35 55 L 15 55 L 50 100 L 85 55 L 65 55 L 65 0 Z','Double Arrow':'M 0 50 L 25 20 L 25 38 L 75 38 L 75 20 L 100 50 L 75 80 L 75 62 L 25 62 L 25 80 Z',Chevron:'M 10 0 L 45 0 L 95 50 L 45 100 L 10 100 L 60 50 Z','Curved Arrow':'M 8 92 C 8 45 35 22 68 22 L 68 4 L 98 34 L 68 64 L 68 44 C 48 44 30 58 30 92 Z','Speech Bubble':'M 15 5 L 85 5 C 93 5 100 12 100 20 L 100 60 C 100 68 93 75 85 75 L 45 75 L 20 98 L 25 75 L 15 75 C 7 75 0 68 0 60 L 0 20 C 0 12 7 5 15 5 Z','Round Bubble':'M 50 5 C 78 5 100 22 100 42 C 100 62 78 79 50 79 C 44 79 38 78 33 77 L 12 95 L 18 72 C 7 65 0 54 0 42 C 0 22 22 5 50 5 Z','Thought Bubble':'M 50 8 C 76 8 96 22 96 40 C 96 58 74 72 50 72 C 24 72 4 58 4 40 C 4 22 24 8 50 8 Z M 22 82 A 8 8 0 1 0 22 98 A 8 8 0 1 0 22 82',Leaf:'M 50 0 C 80 20 95 50 80 75 C 72 88 60 92 53 92 L 53 100 L 47 100 L 47 92 C 40 92 28 88 20 75 C 5 50 20 20 50 0 Z',Sun:'M50 28 A22 22 0 1 0 50 72 A22 22 0 1 0 50 28 M50 4 V18 M50 82 V96 M8 50 H22 M78 50 H96',Cloud:'M 25 80 C 10 80 0 70 0 58 C 0 46 10 37 22 37 C 24 20 38 10 54 10 C 70 10 82 20 85 34 C 95 35 100 45 100 57 C 100 70 90 80 78 80 Z',Raindrop:'M 50 0 C 60 25 85 45 85 68 C 85 87 69 100 50 100 C 31 100 15 87 15 68 C 15 45 40 25 50 0 Z',Flower:'M50 42 A8 8 0 1 0 50 58 A8 8 0 1 0 50 42 M50 8 C62 20 62 34 50 42 C38 34 38 20 50 8 M92 50 C80 62 66 62 58 50 C66 38 80 38 92 50 M50 92 C38 80 38 66 50 58 C62 66 62 80 50 92 M8 50 C20 38 34 38 42 50 C34 62 20 62 8 50',Tree:'M 50 0 L 85 45 L 68 45 L 92 75 L 56 75 L 56 100 L 44 100 L 44 75 L 8 75 L 32 45 L 15 45 Z',Fish:'M 0 50 C 15 25 45 15 70 32 L 96 12 L 88 50 L 96 88 L 70 68 C 45 85 15 75 0 50 Z',Cat:'M 15 10 L 35 30 C 45 27 55 27 65 30 L 85 10 L 88 50 C 92 75 72 95 50 95 C 28 95 8 75 12 50 Z',Bird:'M 0 40 C 15 30 35 32 50 50 C 65 32 85 30 100 40 C 85 40 65 48 50 70 C 35 48 15 40 0 40 Z',Butterfly:'M 50 30 C 40 5 5 0 5 25 C 5 45 30 50 45 50 C 25 55 10 75 25 90 C 38 100 48 80 50 65 C 52 80 62 100 75 90 C 90 75 75 55 55 50 C 70 50 95 45 95 25 C 95 0 60 5 50 30 Z','Paw Print':'M 50 50 C 68 50 82 66 82 80 C 82 92 70 96 60 94 C 55 93 52 91 50 91 C 48 91 45 93 40 94 C 30 96 18 92 18 80 C 18 66 32 50 50 50 Z',Rabbit:'M34 52 C22 30 24 2 34 2 C44 2 46 30 44 50 M66 52 C78 30 76 2 66 2 C56 2 54 30 56 50 M50 46 A26 26 0 1 0 50 98 A26 26 0 1 0 50 46','Crescent Moon':'M62 12 A38 38 0 1 0 62 88 A28 28 0 1 1 62 12','Shout Bubble':'M50 8 L62 28 L88 16 L74 40 L98 50 L74 62 L90 86 L62 72 L50 96 L38 72 L10 86 L26 62 L2 50 L26 40 L12 16 L38 28 Z'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');
    const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||'M20 20 H80 V80 H20 Z');p.setAttribute('fill','none');p.setAttribute('stroke','#e6e6e6');p.setAttribute('stroke-width','4');p.setAttribute('stroke-linejoin','round');svg.append(p);return svg;
  }
  function shapePicker(){
    const names=[...new Set([...(state.customShapes||[]).map(shape=>shape.name),'Heart','Star','Six-Point Star','Burst','Check Mark','Cross','Plus','Ring','Lightning','Diamond','Arrow Right','Arrow Left','Arrow Up','Arrow Down','Double Arrow','Chevron','Curved Arrow','Speech Bubble','Round Bubble','Thought Bubble','Shout Bubble','Leaf','Sun','Crescent Moon','Cloud','Raindrop','Flower','Tree','Fish','Cat','Bird','Butterfly','Paw Print','Rabbit'])];
    const b=document.createElement('button');b.type='button';b.className='shape-pick';b.title=opt.customShapeName;
    const chev=document.createElement('img');chev.src='icons/chevron-down.svg';chev.alt='';
    b.append(shapeGlyph(opt.customShapeName),chev);
    const menu=document.createElement('div');menu.className='menu-popup shape-grid';menu.hidden=true;
    for(const name of names){const item=document.createElement('button');item.type='button';item.title=t(name);item.classList.toggle('on',name===opt.customShapeName);item.append(shapeGlyph(name));item.onclick=()=>{opt.customShapeName=name;state.customShape=name;menu.hidden=true;show(current);};menu.append(item);}
    b.onclick=event=>{event.stopPropagation();menu.hidden=!menu.hidden;if(!menu.hidden){const r=b.getBoundingClientRect();menu.style.left=r.left+'px';menu.style.top=(r.bottom+4)+'px';}};
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==b)menu.hidden=true;});
    return [b,menu];
  }
  function shapeBar(tool){
    const strokeSwatch=swatch();
    if(opt.strokeStyle==='none'){strokeSwatch.style.background='#2c2c2c';strokeSwatch.textContent='';const slash=document.createElementNS('http://www.w3.org/2000/svg','svg');slash.setAttribute('viewBox','0 0 30 22');slash.setAttribute('width','30');slash.setAttribute('height','22');const mark=document.createElementNS(slash.namespaceURI,'line');mark.setAttribute('x1','3');mark.setAttribute('y1','19');mark.setAttribute('x2','27');mark.setAttribute('y2','3');mark.setAttribute('stroke','#e23');mark.setAttribute('stroke-width','1.5');mark.setAttribute('vector-effect','non-scaling-stroke');slash.append(mark);strokeSwatch.append(slash);}
    const nodes=[pick('vectorMode',[['shape','Shape']],80),sep(),label('Fill:'),check('','shapeFill'),swatch(),label('Stroke:'),strokeSwatch,num('strokeWidth',0,288,' px',58),...styleButton()];
    if(tool==='rectangle')nodes.push(sep(),label('Radius:'),num('shapeRadius',0,10000,' px',62));
    if(tool==='polygon')nodes.push(sep(),label('Sides:'),num('polygonSides',3,100,'',48));
    if(tool==='line')nodes.push(sep(),label('Weight:'),num('lineWeight',1,1000,' px',58));
    if(tool==='customShape')nodes.push(sep(),label('Shape:'),...shapePicker());
    return nodes;
  }
  function typeStyles(family){const styles=getFontStyles(family).map(style=>style.name);return styles.length?styles:['Regular'];}
  function typeBar(){
    const font=document.createElement('select');font.style.width='170px';
    const names=[...document.querySelectorAll('#text-font option')].map(o=>o.value).filter(Boolean);
    if(!names.length)names.push('Inter');
    for(const name of names){const o=document.createElement('option');o.value=name;o.textContent=name;font.append(o);}
    if(!names.includes(opt.typeFont))opt.typeFont=names[0];
    font.value=opt.typeFont;font.onchange=()=>{opt.typeFont=font.value;opt.typeStyle=typeStyles(font.value)[0]||'Regular';const source=document.querySelector('#text-font');if(source){source.value=font.value;source.dispatchEvent(new Event('change',{bubbles:true}));}command('panel.type.style',{style:opt.typeStyle});show(current);};
    const styles=typeStyles(opt.typeFont);if(!styles.includes(opt.typeStyle))opt.typeStyle=styles[0];
    const turn=icon('text-cursor','Toggle text orientation',false,()=>{const next={text:'verticalType',verticalType:'text',horizontalTypeMask:'verticalTypeMask',verticalTypeMask:'horizontalTypeMask'}[current];if(!next)return;const btn=[...document.querySelectorAll('#tools [data-tool-group]')].find(el=>el.dataset.toolGroup.split(',').includes(next));if(!btn)return;if(btn.dataset.tool!==next){const r=btn.getBoundingClientRect();btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+8,clientY:r.y+8}));document.querySelectorAll('.tool-flyout-row')[btn.dataset.toolGroup.split(',').indexOf(next)]?.click();}else btn.click();});
    return [turn,font,pick('typeStyle',styles.map(name=>[name,name]),110),num('typeSize',1,1296,'',66),label('pt'),pick('typeAA',[['none','None'],['sharp','Sharp'],['crisp','Crisp'],['strong','Strong'],['smooth','Smooth']],80),sep(),icon('align-left','Left align text',opt.typeAlign==='left',()=>{opt.typeAlign='left';show(current);}),icon('align-center','Center text',opt.typeAlign==='center',()=>{opt.typeAlign='center';show(current);}),icon('align-right','Right align text',opt.typeAlign==='right',()=>{opt.typeAlign='right';show(current);}),sep(),swatch()];
  }
  return show;
}
