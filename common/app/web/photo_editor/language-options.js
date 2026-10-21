const FEATURES=['defaultFeatures','eastAsianFeatures','middleEasternFeatures'];
export function languageOption(current,id,on){
  const key=String(id||'').slice('type.languageOptions.'.length);
  if(key==='middleEasternAndSouthAsianComposer')return {...current,middleEasternComposer:on==null?!current.middleEasternComposer:Boolean(on)};
  if(!FEATURES.includes(key))throw Error('unknown language option');
  return {...current,languageFeatures:key};
}
