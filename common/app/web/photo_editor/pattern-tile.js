// Embedded RGB pattern tiles as exposed by the bundled PSD reader.
export function patternTile(value){
  if(!value||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width>32767||value.height>32767||value.width*value.height>64000000)return null;
  const source=value.data;if(!(Array.isArray(source)||source instanceof Uint8Array||source instanceof Uint8ClampedArray)||source.length!==value.width*value.height*4)return null;
  if(Array.isArray(source)&&source.some(v=>!Number.isInteger(v)||v<0||v>255))return null;
  return{...value,data:source};
}
export function patternCanvas(value){
  const tile=patternTile(value);if(!tile)throw Error('Invalid embedded pattern tile.');
  const canvas=document.createElement('canvas');canvas.width=tile.width;canvas.height=tile.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tile.data),tile.width,tile.height),0,0);return canvas;
}

// Wrapped, premultiplied bilinear luminance: compose/pattern.rs Tile::sample.
export function patternLuminance(tile,u,v){
  u-=.5;v-=.5;const x=Math.floor(u),y=Math.floor(v),fx=u-x,fy=v-y,wrap=(n,size)=>((n%size)+size)%size;let value=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const k=(dx?fx:1-fx)*(dy?fy:1-fy),i=(wrap(y+dy,tile.height)*tile.width+wrap(x+dx,tile.width))*4;value+=k*(.299*tile.data[i]+.587*tile.data[i+1]+.114*tile.data[i+2])/255*tile.data[i+3]/255;}return value;
}
