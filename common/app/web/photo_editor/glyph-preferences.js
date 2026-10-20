let protection=true,ready;
export async function prepareGlyphProtection(enabled){if(!enabled&&!ready){ready=(async()=>{const face=new FontFace('Chameleon Missing Glyph',`url(${new URL('./fonts/missing-glyph.woff',import.meta.url).href})`,{unicodeRange:'U+0-10FFFF'});await face.load();document.fonts.add(face);})();ready.catch(()=>{ready=null;});}if(!enabled)await ready;return{apply(){protection=Boolean(enabled);},stage(callback){const old=protection;protection=Boolean(enabled);try{return callback();}finally{protection=old;}}};}
export async function setGlyphProtection(enabled){(await prepareGlyphProtection(enabled)).apply();}
export function glyphFallback(){return protection?'':', "Chameleon Missing Glyph"';}
