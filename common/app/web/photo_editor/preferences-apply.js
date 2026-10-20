import {bindText} from './i18n.js';
export function mountPreferenceApply(dialog,commit,onError){
  const body=dialog.querySelector('#dialog-body'),actions=dialog.querySelector('.dialog-actions'),button=document.createElement('button');button.type='button';bindText(button,'Apply');actions.insertBefore(button,actions.lastElementChild);
  const form=dialog.querySelector('form'),wasNoValidate=form.noValidate;form.noValidate=true;
  const inputs=()=>[...body.querySelectorAll('[name]')],values=()=>Object.fromEntries(inputs().map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]));
  const status=document.createElement('p');status.setAttribute('role','alert');status.hidden=true;actions.before(status);
  let baseline=JSON.stringify(values()),busy=false,disposed=false;
  const update=()=>button.disabled=busy||JSON.stringify(values())===baseline;
  const guard=event=>{if(busy)event.preventDefault();};
  const save=async(close=false)=>{if(busy)return;const form=dialog.querySelector('form');if(!form.reportValidity())return;
    const focused=document.activeElement,wasBusy=dialog.getAttribute('aria-busy'),draft=values();
    status.hidden=true;status.textContent='';busy=true;dialog.setAttribute('aria-busy','true');const controls=[...dialog.querySelectorAll('input,select,textarea,button')],previous=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
    try{const normalized=await commit(draft);if(disposed)return;for(const input of inputs()){if(!Object.hasOwn(normalized,input.name))continue;if(input.type==='checkbox')input.checked=normalized[input.name];else input.value=String(normalized[input.name]);input.dispatchEvent(new Event('change',{bubbles:true}));}baseline=JSON.stringify(values());if(close)dialog.close('ok');}
    catch(error){status.textContent=error.message||String(error);status.hidden=false;onError(error);}finally{busy=false;if(wasBusy===null)dialog.removeAttribute('aria-busy');else dialog.setAttribute('aria-busy',wasBusy);controls.forEach((control,index)=>control.disabled=previous[index]);update();if(!disposed&&dialog.open&&focused?.isConnected&&!focused.disabled)focused.focus();}
  };
  button.onclick=()=>save(false);
  const submit=event=>{event.preventDefault();if(!busy)void save(true);};
  body.addEventListener('input',update);body.addEventListener('change',update);dialog.addEventListener('cancel',guard);dialog.querySelector('form').addEventListener('submit',submit);update();
  return()=>{disposed=true;form.noValidate=wasNoValidate;body.removeEventListener('input',update);body.removeEventListener('change',update);dialog.removeEventListener('cancel',guard);dialog.querySelector('form').removeEventListener('submit',submit);button.remove();status.remove();};
}
