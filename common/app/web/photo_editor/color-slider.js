// Preferences › Interface › Dynamic Color Sliders for adjustment tracks.
// PhotoCraft widgets::hue_stops and adjust_editors saturation/lightness/channel tracks.
function hsv(h,s,v){const hh=((h%1)+1)%1*6,i=Math.floor(hh),f=hh-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s),row=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i%6];return row.map(n=>Math.round(n*255));}
function rgb(color){return `rgb(${color[0]},${color[1]},${color[2]})`;}
export function hueStops(){return Array.from({length:13},(_,i)=>rgb(hsv(i/12,.85,1)));}
export function hueColor(deg){return rgb(hsv((((deg%360)+360)%360)/360,1,1));}
export function dynamicSlidersOn(){return !document.body.classList.contains('preference-static-color-sliders');}
export function attachColorTrack(input,stops){
  if(!input||input.dataset.colorTrack==='1')return input?.previousElementSibling;
  const range=document.createElement('input');range.type='range';range.className='dynamic-color-range';range.min=input.min;range.max=input.max;range.step=input.step||'1';range.value=input.value;range.setAttribute('aria-label',input.getAttribute('aria-label')||input.closest('label')?.textContent||'');
  const paint=()=>{range.style.background=dynamicSlidersOn()&&stops?.length?`linear-gradient(90deg,${stops.join(',')})`:'';};
  const pull=()=>{const value=String(Math.max(Number(input.min),Math.min(Number(input.max),Number(range.value))));if(input.value!==value){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}};
  range.addEventListener('input',pull);input.addEventListener('input',()=>{range.value=input.value;paint();});input.before(range);input.dataset.colorTrack='1';paint();return range;
}
export function mountAdjustmentColorTracks(body,kind){
  const number=name=>body.querySelector(`[name="${name}"]`);
  if(kind==='hueSaturation'){
    const hue=number('hue'),saturation=number('saturation'),lightness=number('lightness');
    if(!hue)return;
    attachColorTrack(hue,hueStops());
    const follow=()=>{const color=hueColor(Number(hue.value)||0);attachColorTrack(saturation,['rgb(128,128,128)',color]);attachColorTrack(lightness,['rgb(0,0,0)',color,'rgb(255,255,255)']);saturation.previousElementSibling.style.background=dynamicSlidersOn()?`linear-gradient(90deg,rgb(128,128,128),${color})`:'';lightness.previousElementSibling.style.background=dynamicSlidersOn()?`linear-gradient(90deg,rgb(0,0,0),${color},rgb(255,255,255))`:'';};
    hue.addEventListener('input',follow);follow();
  }
  if(kind==='blackWhite')[['reds',[230,50,50]],['yellows',[235,215,40]],['greens',[50,200,70]],['cyans',[40,200,220]],['blues',[50,90,235]],['magentas',[220,50,210]]].forEach(([name,color])=>attachColorTrack(number(name),['rgb(0,0,0)',rgb(color)]));
  if(kind==='channelMixer'){const colors={Red:[225,50,50],Green:[50,190,70],Blue:[60,100,235]};for(const input of body.querySelectorAll('input[type=number]')){const match=input.name.match(/(?:red|green|blue|gray)(Red|Green|Blue)$/);if(match)attachColorTrack(input,['rgb(0,0,0)',rgb(colors[match[1]])]);}}
  if(kind==='colorBalance'||kind==='colorbalance'){const colors={Red:['rgb(0,190,210)','rgb(225,40,40)'],Green:['rgb(210,40,190)','rgb(40,190,60)'],Blue:['rgb(230,210,30)','rgb(40,80,230)']};for(const input of body.querySelectorAll('input[type=number]')){const match=input.name.match(/(Red|Green|Blue)$/);if(match)attachColorTrack(input,colors[match[1]]);}}
}
