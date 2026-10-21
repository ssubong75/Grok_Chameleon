import {insertGlyphText} from './glyph-text.js';
export const LOREM_IPSUM='Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
export function loremInsert(value,at){return insertGlyphText(value??'',LOREM_IPSUM,at==null?{}:{at});}
export function loremLayerPlan(width,height){
  const size=Math.max(6,Math.min(72,height/20));
  return {value:LOREM_IPSUM,mode:'paragraph',x:width*.1,y:height*.1,boxWidth:width*.7,boxHeight:height*.7,font:'Inter',size};
}
