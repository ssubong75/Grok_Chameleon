import {surface,loadImage,EditorDocument} from './engine.js';
import {readDocument} from './psd.js';
import {readTIFF,tiffPages} from './tiff.js';
export function chooseMapFile(){
  return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.accept='image/*,.psd,.psb,.tif,.tiff,.gcphoto';
    input.hidden=true;document.body.append(input);let finished=false;
    const finish=file=>{if(finished)return;finished=true;input.remove();resolve(file);};
    input.addEventListener('change',()=>finish(input.files?.[0]||null),{once:true});
    input.addEventListener('cancel',()=>finish(null),{once:true});input.click();
  });
}
export async function readMapFile(file){
  if(/\.(psd|psb)$/i.test(file.name)){const result=await readDocument(await file.arrayBuffer(),file.name);return result.storedComposite||result.document.composite();}
  if(/\.tiff?$/i.test(file.name)){const bytes=await file.arrayBuffer(),pages=tiffPages(bytes);if(!pages.length)throw Error('The TIFF map has no image pages.');return readTIFF(bytes,pages[0],pages);}
  if(/\.gcphoto$/i.test(file.name))return(await EditorDocument.fromProject(await file.text())).composite();
  const url=URL.createObjectURL(file);try{const image=await loadImage(url);if(!image.width||!image.height||image.width>32767||image.height>32767||image.width*image.height>64000000)throw Error('The displacement map exceeds the image size limits.');const canvas=surface(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return canvas;}finally{URL.revokeObjectURL(url);}
}
