import {timelineTime} from './timeline.js';
export function installTimelinePanel({getDocument}){
  const panel=document.createElement('section');
  panel.id='timeline-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Timeline');
  const title=document.createElement('div');title.className='timeline-title';
  const heading=document.createElement('strong');heading.textContent='Timeline';
  const close=document.createElement('button');close.textContent='×';close.title='Close';close.setAttribute('aria-label','Close');close.onclick=()=>setOpen(false);
  title.append(heading,close);
  const body=document.createElement('div');body.className='timeline-body';
  panel.append(title,body);document.body.append(panel);
  let open=false,playing=false,timer=0;
  function stop(){playing=false;clearInterval(timer);timer=0;}
  function setOpen(value){open=Boolean(value);if(!open)stop();panel.hidden=!open;render();}
  function render(){
    body.replaceChildren();
    const d=getDocument();
    if(!d){const note=document.createElement('p');note.textContent='Open a document to use the timeline.';body.append(note);return;}
    const tl=d.timeline;
    if(!tl){const button=document.createElement('button');button.textContent='Create Video Timeline';button.onclick=()=>{try{d.createTimeline(30,30);render();}catch(error){const note=document.createElement('p');note.textContent=error.message;body.append(note);}};const hint=document.createElement('p');hint.textContent='30 frames @ 30 fps';body.append(button,hint);return;}
    const row=document.createElement('div');row.className='timeline-row';
    const play=document.createElement('button');play.textContent=playing?'Pause':'Play';play.setAttribute('aria-pressed',String(playing));play.onclick=()=>{if(playing){stop();render();return;}playing=true;const period=1000/Math.max(1,tl.fps);timer=setInterval(()=>{const doc=getDocument();if(!doc?.timeline){stop();render();return;}doc.setTimelineFrame((doc.timeline.current+1)%doc.timeline.duration);render();},period);render();};
    const prev=document.createElement('button');prev.textContent='Previous frame';prev.onclick=()=>{stop();d.stepTimeline(-1);render();};
    const label=document.createElement('span');label.textContent='Frame '+(tl.current+1)+' / '+tl.duration;
    const next=document.createElement('button');next.textContent='Next frame';next.onclick=()=>{stop();d.stepTimeline(1);render();};
    const time=document.createElement('span');time.textContent=timelineTime(tl).toFixed(2)+'s';
    const fps=document.createElement('span');fps.textContent=Math.round(tl.fps)+' fps';
    const remove=document.createElement('button');remove.textContent='Delete Timeline';remove.onclick=()=>{stop();d.deleteTimeline();render();};
    row.append(play,prev,label,next,time,fps,remove);body.append(row);
    if(tl.duration>1){const scrub=document.createElement('input');scrub.type='range';scrub.min='0';scrub.max=String(tl.duration-1);scrub.value=String(tl.current);scrub.setAttribute('aria-label','playhead');scrub.oninput=()=>{stop();d.setTimelineFrame(Number(scrub.value));render();};body.append(scrub);}
  }
  return {isOpen:()=>open,setOpen,render};
}
