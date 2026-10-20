export function mountTypePreflight(dialog,prepare){
 const form=dialog.querySelector('form'),body=dialog.querySelector('#dialog-body'),status=document.createElement('p');status.setAttribute('role','alert');status.hidden=true;body.after(status);let busy=false,disposed=false;
 const cancel=event=>{if(busy)event.preventDefault();};
 const submit=async event=>{event.preventDefault();if(busy)return;const values=Object.fromEntries([...body.querySelectorAll('[name]')].map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]));
  busy=true;status.hidden=true;const focused=dialog.ownerDocument.activeElement,controls=[...dialog.querySelectorAll('input,select,textarea,button')],disabled=controls.map(input=>input.disabled);controls.forEach(input=>input.disabled=true);dialog.setAttribute('aria-busy','true');
  try{await prepare(values);if(!disposed)dialog.close('ok');}catch(error){if(!disposed){status.textContent=error.message||String(error);status.hidden=false;}}finally{busy=false;dialog.removeAttribute('aria-busy');controls.forEach((input,index)=>input.disabled=disabled[index]);if(!disposed&&dialog.open&&focused?.isConnected)focused.focus();}
 };
 form.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);
 return()=>{disposed=true;form.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);status.remove();};
}
