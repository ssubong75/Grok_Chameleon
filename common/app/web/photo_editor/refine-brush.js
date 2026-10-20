const TILE=64,MAX_HISTORY=32*1024*1024;
const strength=code=>code>256?code-256:Math.abs(code);
export class RefineBrush{
  constructor(canvas,container,width,height,onChange){
    this.canvas=canvas;this.width=width;this.height=height;this.onChange=onChange;this.map=null;this.markCount=0;this.undo=[];this.redo=[];this.historyBytes=0;this.stroke=null;this.cursor=null;this.revision=0;this.markRevision=-1;this.cache=null;this.markCanvas=document.createElement('canvas');
    const surface=document.createElement('div');surface.className='refine-surface';canvas.before(surface);surface.append(canvas);this.overlay=document.createElement('canvas');this.overlay.className='refine-brush-overlay';surface.append(this.overlay);
    const group=document.createElement('fieldset');group.className='refine-brush-controls';const legend=document.createElement('legend');legend.textContent='Edge Brush';group.append(legend);container.prepend(group);
    const add=(label,input)=>{const row=document.createElement('label');row.textContent=label;row.append(input);group.append(row);return input;};
    this.mode=document.createElement('select');for(const [value,text]of [['refine','Refine Edge'],['add','Add to Selection'],['subtract','Subtract from Selection'],['erase','Erase Brush Marks']]){const option=document.createElement('option');option.value=value;option.textContent=text;this.mode.append(option);}add('Mode',this.mode);
    this.size=document.createElement('input');this.size.type='number';this.size.min=1;this.size.max=2000;this.size.value=40;add('Size (px)',this.size);
    this.hardness=document.createElement('input');this.hardness.type='number';this.hardness.min=0;this.hardness.max=100;this.hardness.value=50;add('Hardness (%)',this.hardness);
    this.marks=document.createElement('input');this.marks.type='checkbox';this.marks.checked=true;add('Show Brush Marks',this.marks);this.marks.oninput=()=>this.draw();
    const actions=document.createElement('div');actions.className='refine-brush-actions';this.undoButton=document.createElement('button');this.redoButton=document.createElement('button');const clear=document.createElement('button');for(const button of [this.undoButton,this.redoButton,clear])button.type='button';this.undoButton.textContent='Undo Brush';this.redoButton.textContent='Redo Brush';clear.textContent='Clear Brush';actions.append(this.undoButton,this.redoButton,clear);group.append(actions);
    this.undoButton.onclick=()=>this.travel(false);this.redoButton.onclick=()=>this.travel(true);clear.onclick=()=>this.clear();
    const note=document.createElement('p');note.textContent='Paint over uncertain edges. Option/Alt switches Refine to Erase and Add to Subtract.';group.append(note);
    this.listeners=[];const on=(target,name,handler)=>{target.addEventListener(name,handler);this.listeners.push(()=>target.removeEventListener(name,handler));};
    on(canvas,'pointerdown',event=>{if(event.button!==0||this.stroke)return;if(!this.size.reportValidity()||!this.hardness.reportValidity())return;event.preventDefault();this.stroke={tiles:new Map(),last:this.point(event),mode:event.altKey?(this.mode.value==='add'?'subtract':this.mode.value==='subtract'?'add':'erase'):this.mode.value};canvas.setPointerCapture(event.pointerId);this.paint(this.stroke.last,this.stroke.last);this.buttons();});
    on(canvas,'pointermove',event=>{this.cursor=this.point(event);if(this.stroke){event.preventDefault();this.paint(this.stroke.last,this.cursor);this.stroke.last=this.cursor;}else this.draw();});
    on(canvas,'pointerleave',()=>{if(!this.stroke){this.cursor=null;this.draw();}});
    on(canvas,'pointerup',event=>{if(!this.stroke)return;event.preventDefault();const entry=this.stroke;this.stroke=null;if(entry.tiles.size){this.push(entry);this.redo=[];}if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);this.buttons();});
    on(canvas,'pointercancel',()=>this.cancelStroke());on(window,'blur',()=>this.cancelStroke());this.buttons();this.resize();
  }
  get hasMarks(){return this.markCount>0;}
  point(event){const r=this.canvas.getBoundingClientRect();return{x:(event.clientX-r.left)*this.width/r.width,y:(event.clientY-r.top)*this.height/r.height};}
  resize(){this.overlay.width=this.canvas.width;this.overlay.height=this.canvas.height;this.markRevision=-1;this.draw();}
  tile(key){const columns=Math.ceil(this.width/TILE),x=(key%columns)*TILE,y=Math.floor(key/columns)*TILE,w=Math.min(TILE,this.width-x),h=Math.min(TILE,this.height-y),values=new Int16Array(w*h);for(let row=0;row<h;row++)values.set(this.map.subarray((y+row)*this.width+x,(y+row)*this.width+x+w),row*w);return{x,y,w,h,values};}
  restore(tile){for(let row=0;row<tile.h;row++){const at=(tile.y+row)*this.width+tile.x;for(let x=0;x<tile.w;x++)this.markCount+=Number(tile.values[row*tile.w+x]!==0)-Number(this.map[at+x]!==0);this.map.set(tile.values.subarray(row*tile.w,(row+1)*tile.w),at);}}
  remember(x,y){const key=Math.floor(y/TILE)*Math.ceil(this.width/TILE)+Math.floor(x/TILE);if(!this.stroke.tiles.has(key))this.stroke.tiles.set(key,this.tile(key));}
  paint(a,b){
    if(!this.map)this.map=new Int16Array(this.width*this.height);
    const radius=Number(this.size.value)/2,hardness=Number(this.hardness.value)/100,mode=this.stroke.mode,span=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(span/Math.max(.5,radius*.25)));let changed=false;
    for(let step=0;step<=steps;step++){const cx=a.x+(b.x-a.x)*step/steps,cy=a.y+(b.y-a.y)*step/steps;
      for(let y=Math.max(0,Math.floor(cy-radius-1));y<Math.min(this.height,Math.ceil(cy+radius+1));y++)for(let x=Math.max(0,Math.floor(cx-radius-1));x<Math.min(this.width,Math.ceil(cx+radius+1));x++){
        const distance=Math.hypot(x+.5-cx,y+.5-cy),weight=Math.max(0,Math.min(1,(radius+.5-distance)/Math.max(.5,radius*(1-hardness))));if(weight<=0)continue;
        const i=y*this.width+x,alpha=Math.max(1,Math.round(255*weight));let code=mode==='refine'?256+alpha:mode==='add'?alpha:mode==='subtract'?-alpha:0,old=this.map[i];
        const same=mode==='refine'?old>256:mode==='add'?old>0&&old<=255:mode==='subtract'?old<0:false;if(same&&strength(old)>alpha)code=old;
        if(code===old)continue;this.remember(x,y);this.markCount+=Number(code!==0)-Number(old!==0);this.map[i]=code;changed=true;
      }
    }
    this.cursor=b;if(changed)this.revision++;this.draw();if(changed)this.onChange();
  }
  push(entry){entry.bytes=[...entry.tiles.values()].reduce((total,tile)=>total+tile.values.byteLength,0);this.undo.push(entry);this.historyBytes+=entry.bytes;while(this.undo.length>1&&this.historyBytes>MAX_HISTORY)this.historyBytes-=this.undo.shift().bytes;}
  travel(forward){if(this.stroke)return;const from=forward?this.redo:this.undo,entry=from.pop();if(!entry)return;if(!forward)this.historyBytes-=entry.bytes;const next={tiles:new Map()};for(const [key,tile]of entry.tiles){next.tiles.set(key,this.tile(key));this.restore(tile);}if(forward)this.push(next);else this.redo.push(next);this.revision++;this.buttons();this.draw();this.onChange();}
  clear(){if(this.stroke||!this.hasMarks)return;const entry={tiles:new Map()},columns=Math.ceil(this.width/TILE);for(let y=0;y<this.height;y+=TILE)for(let x=0;x<this.width;x+=TILE){const key=Math.floor(y/TILE)*columns+Math.floor(x/TILE),tile=this.tile(key);if(tile.values.some(Boolean))entry.tiles.set(key,tile);}if(!entry.tiles.size)return;this.map.fill(0);this.markCount=0;this.revision++;this.push(entry);this.redo=[];this.buttons();this.draw();this.onChange();}
  cancelStroke(){if(!this.stroke)return;for(const tile of this.stroke.tiles.values())this.restore(tile);this.stroke=null;this.revision++;this.buttons();this.draw();this.onChange();}
  buttons(){this.undoButton.disabled=!!this.stroke||!this.undo.length;this.redoButton.disabled=!!this.stroke||!this.redo.length;}
  proxyMap(width,height){if(this.cache?.revision===this.revision&&this.cache.width===width&&this.cache.height===height)return this.cache.map;const output=new Int16Array(width*height);if(!this.hasMarks){this.cache={revision:this.revision,width,height,map:output};return output;}const sx=this.width/width,sy=this.height/height;for(let y=0;y<height;y++)for(let x=0;x<width;x++){let code=0;for(const [ox,oy]of [[.5,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85]]){const xx=Math.min(this.width-1,Math.floor((x+ox)*sx)),yy=Math.min(this.height-1,Math.floor((y+oy)*sy)),candidate=this.map[yy*this.width+xx];if(strength(candidate)>strength(code))code=candidate;}output[y*width+x]=code;}this.cache={revision:this.revision,width,height,map:output};return output;}
  draw(){
    const ctx=this.overlay.getContext('2d'),w=this.overlay.width,h=this.overlay.height;ctx.clearRect(0,0,w,h);
    if(this.marks.checked){
      if(this.markRevision!==this.revision||this.markCanvas.width!==w||this.markCanvas.height!==h){
        this.markCanvas.width=w;this.markCanvas.height=h;const marks=this.markCanvas.getContext('2d'),map=this.proxyMap(w,h),image=marks.createImageData(w,h);
        for(let i=0;i<map.length;i++){const code=map[i];if(!code)continue;const j=i*4;image.data[j]=code>256?255:code<0?255:40;image.data[j+1]=code>256?190:code<0?60:230;image.data[j+2]=code>256?40:code<0?60:100;image.data[j+3]=Math.round(strength(code)*.5);}marks.putImageData(image,0,0);this.markRevision=this.revision;
      }
      ctx.drawImage(this.markCanvas,0,0);
    }
    if(this.cursor){ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(this.cursor.x*w/this.width,this.cursor.y*h/this.height,Math.max(.5,Math.min(1000,Number(this.size.value)/2||20))*w/this.width,Math.max(.5,Math.min(1000,Number(this.size.value)/2||20))*h/this.height,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#000';ctx.setLineDash([3,3]);ctx.stroke();ctx.restore();}
  }
  dispose(){this.cancelStroke();for(const remove of this.listeners)remove();this.listeners=[];this.undo=[];this.redo=[];}
}
