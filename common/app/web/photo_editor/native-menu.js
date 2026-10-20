import {t} from './i18n.js';
import {languages} from './languages.js';
import {preferenceSections} from './preferences-ui.js';
import {themeLabels,darkThemes} from './interface-themes.js';
const separator={type:'separator'};
export function installNativeMenu({host,menus,buildMenu,command,preferences,commitAppearance,onError}){
  if(!host?.syncMenu||!host?.onMenuCommand)return()=>{};
  let timer=0;
  const item=(label,id,extra={})=>({label:t(label,id),command:id,...extra});
  function sync(){
    const retained=[...document.querySelectorAll('.menu-popup')];for(const popup of retained)popup.remove();
    try{
      const prefs=preferences(),anchor={getBoundingClientRect:()=>({left:0,right:0,top:0,bottom:0})};
      const read=entries=>{
        const popup=buildMenu(entries,anchor,0),rows=[];
        for(const node of popup.children){if(node.tagName==='HR'){rows.push(separator);continue;}
          const entry=entries[Number(node.dataset.entryIndex)];
          const label=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('');
          const row={label,enabled:!node.disabled};
          if(entry&&Array.isArray(entry[1]))row.submenu=read(entry[1]);
          else{row.command=node.dataset.command;const key=node.querySelector('kbd')?.textContent;if(key)row.accelerator=key.replaceAll('⌘','Command+').replaceAll('⇧','Shift+').replaceAll('⌥','Alt+');if(node.hasAttribute('aria-checked'))row.checked=node.getAttribute('aria-checked')==='true';}
          rows.push(row);
        }popup.remove();return rows;
      };
      const bar=Object.entries(menus).filter(([name])=>name!=='Help').map(([name,entries])=>({label:t(name),submenu:read(entries)}));
      const clean=rows=>rows.filter(row=>!(row.command==='file.exit'||row.command==='chrome.about'||row.command==='edit.preferences'||row.command?.startsWith('edit.preferences.'))).map(row=>row.submenu?{...row,submenu:clean(row.submenu)}:row).filter(row=>!row.submenu||row.submenu.length);
      for(const menu of bar)menu.submenu=clean(menu.submenu);
      const appMenu={label:'Photo Editor',submenu:[
        {label:t('Settings'),submenu:preferenceSections.map(([id,label])=>item(label,'edit.preferences.'+id))},
        {label:t('Language'),submenu:[item('Auto','app.language.auto',{checked:prefs.language==='auto'}),separator,...languages.map(([code,label])=>({label,command:'app.language.'+code,checked:prefs.language===code}))]},
        {label:t('Appearance'),submenu:[...Object.entries(themeLabels).map(([key,label])=>item(label,'app.theme.'+key,{checked:(prefs.appearanceMode==='light'?prefs.lightTheme:prefs.darkTheme)===key})),separator,item('Next Theme','app.theme.next')]},separator,
        {label:t('Services'),role:'services'},separator,
        {label:t('Hide {app}').replace('{app}','Photo Editor'),role:'hide',accelerator:'Control+Command+H'},
        {label:t('Hide Others'),role:'hideOthers'}, {label:t('Show All'),role:'unhide'},separator,
        item('Quit Photo Editor','file.exit',{accelerator:'Command+Q'})]};
      host.syncMenu([appMenu,...bar,{label:'Save to App',command:'file.saveToApp',enabled:!document.querySelector('#save-app').disabled}]);
    }catch(error){onError(error);}finally{document.querySelectorAll('.menu-popup').forEach(node=>node.remove());for(const popup of retained)document.body.append(popup);}
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(sync,0);};
  host.onMenuCommand(async id=>{try{
    if(id.startsWith('app.language.'))await commitAppearance({language:id.slice(13)});
    else if(id.startsWith('app.theme.')){let key=id.slice(10);if(key==='next'){const keys=Object.keys(themeLabels),prefs=preferences(),current=prefs.appearanceMode==='light'?prefs.lightTheme:prefs.darkTheme;key=keys[(keys.indexOf(current)+1)%keys.length];}if(!Object.hasOwn(themeLabels,key))throw Error('Unknown theme.');const dark=darkThemes.includes(key);await commitAppearance({appearanceMode:dark?'dark':'light',[dark?'darkTheme':'lightTheme']:key});}
    else await command(id);
  }catch(error){onError(error);}finally{schedule();}});
  document.addEventListener('editor-language-change',schedule);
  document.addEventListener('click',schedule);document.addEventListener('keyup',schedule);document.addEventListener('pointerup',schedule);
  const observer=new MutationObserver(schedule);observer.observe(document.querySelector('#tabs'),{childList:true,subtree:true});observer.observe(document.querySelector('#dialog'),{attributes:true,attributeFilter:['open']});
  schedule();return schedule;
}
