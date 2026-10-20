// Filter > Other > HSB/HSL port of PhotoCraft algo/other2.rs.
const clamp=value=>Math.max(0,Math.min(1,value));
function hue([r,g,b],max,delta){if(delta<=0)return 0;const value=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;return value/6;}
function hcm(hueValue,chroma,minimum){const hp=((hueValue%1+1)%1)*6,x=chroma*(1-Math.abs(hp%2-1));let rgb;if(hp<1)rgb=[chroma,x,0];else if(hp<2)rgb=[x,chroma,0];else if(hp<3)rgb=[0,chroma,x];else if(hp<4)rgb=[0,x,chroma];else if(hp<5)rgb=[x,0,chroma];else rgb=[chroma,0,x];return rgb.map(value=>value+minimum);}
function rgbToHsb(color){const max=Math.max(...color),min=Math.min(...color),delta=max-min;return[hue(color,max,delta),max?delta/max:0,max];}
function rgbToHsl(color){const max=Math.max(...color),min=Math.min(...color),delta=max-min,light=(max+min)/2;return[hue(color,max,delta),delta?Math.min(1,delta/Math.max(1e-7,1-Math.abs(2*light-1))):0,light];}
function hsbToRgb([h,s,b]){const chroma=b*s;return hcm(h,chroma,b-chroma);}
function hslToRgb([h,s,l]){const chroma=(1-Math.abs(2*l-1))*s;return hcm(h,chroma,l-chroma/2);}
export function hsbHsl(image,settings={}){const input=settings.input||'rgb',output=settings.output||'hsb';if(input===output)return image;for(let index=0;index<image.data.length;index+=4){const value=[0,1,2].map(channel=>clamp(image.data[index+channel]/255)),rgb=input==='rgb'?value:input==='hsb'?hsbToRgb(value):hslToRgb(value),converted=output==='rgb'?rgb:output==='hsb'?rgbToHsb(rgb):rgbToHsl(rgb);for(let channel=0;channel<3;channel++)image.data[index+channel]=Math.round(clamp(converted[channel])*255);}return image;}
