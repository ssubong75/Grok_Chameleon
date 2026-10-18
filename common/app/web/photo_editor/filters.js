// Pixel operations, independent of UI and browser APIs.
import {spatialFilter} from './spatial-filters.js';
import {curveTable} from './curves.js';
import {colorToAlpha} from './color-alpha.js';
import {contentAwareImage} from './content-aware.js';
import {developRaw} from './camera-raw.js';
const clamp = value => Math.max(0,Math.min(255,value));
function hueChannel(p,q,t){if(t<0)t++;if(t>1)t--;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
function shiftHue(r,g,b,degrees){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return [r*255,g*255,b*255];const delta=max-min,s=l>.5?delta/(2-max-min):delta/(max+min);let h=max===r?(g-b)/delta+(g<b?6:0):max===g?(b-r)/delta+2:(r-g)/delta+4;h=((h/6+degrees/360)%1+1)%1;const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;return[hueChannel(p,q,h+1/3)*255,hueChannel(p,q,h)*255,hueChannel(p,q,h-1/3)*255];}
export function adjustPixels(image,name,amount=0){
  if(name==='Color to Alpha')return colorToAlpha(image,amount);
  if(name==='Content-Aware Fill')return contentAwareImage(image,amount);
  if(name==='Camera Raw')return developRaw(image,amount);
  if(spatialFilter(image,name,amount))return image;
  const pixels=image.data;const settings=typeof amount==='object'?amount:{};
  if(name==='Curves'){const table=curveTable(settings),channel={Red:0,Green:1,Blue:2}[settings.channel];for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)if(channel==null||c===channel)pixels[i+c]=table[pixels[i+c]];return image;}
  if(['Sharpen','Emboss','Find Edges'].includes(name)){
    const kernels={Sharpen:[0,-1,0,-1,5,-1,0,-1,0],Emboss:[-2,-1,0,-1,1,1,0,1,2],'Find Edges':[-1,-1,-1,-1,8,-1,-1,-1,-1]};
    const input=new Uint8ClampedArray(pixels),kernel=kernels[name];
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let c=0;c<3;c++){
      let sum=name==='Emboss'?128:0;
      for(let ky=-1;ky<=1;ky++)for(let kx=-1;kx<=1;kx++){const sx=Math.min(image.width-1,Math.max(0,x+kx)),sy=Math.min(image.height-1,Math.max(0,y+ky));sum+=input[(sy*image.width+sx)*4+c]*kernel[(ky+1)*3+kx+1];}
      pixels[(y*image.width+x)*4+c]=clamp(name==='Find Edges'?255-Math.abs(sum):sum);
    }return image;
  }
  const gamma=Math.max(.01,Number(settings.gamma)||1),black=Number(settings.black)||0,white=Math.max(black+1,Number(settings.white)||255);
  for(let i=0;i<pixels.length;i+=4){
    let r=pixels[i],g=pixels[i+1],b=pixels[i+2];
    const luminance=r*.2126+g*.7152+b*.0722;
    if(name==='Hue')[r,g,b]=shiftHue(r,g,b,Number(amount)||0);
    else if(name==='Sepia'){[r,g,b]=[r*.393+g*.769+b*.189,r*.349+g*.686+b*.168,r*.272+g*.534+b*.131];}
    else for(let c=0;c<3;c++){
      let value=pixels[i+c];
      switch(name){
        case 'Invert':value=255-value;break;
        case 'Desaturate':value=luminance;break;
        case 'Brightness':value+=Number(amount);break;
        case 'Contrast':value=(value-128)*(1+Number(amount)/100)+128;break;
        case 'Saturation':value=luminance+(value-luminance)*(1+Number(amount)/100);break;
        case 'Vibrance':{const saturation=(Math.max(r,g,b)-Math.min(r,g,b))/255;value=luminance+(value-luminance)*(1+Number(amount)/100*(1-saturation));break;}
        case 'Color Balance':value+=Number(settings[['red','green','blue'][c]])||0;break;
        case 'Threshold':value=luminance>=Number(amount)?255:0;break;
        case 'Exposure':value*=2**Number(amount);break;
        case 'Gamma':value=255*(value/255)**(1/Math.max(.01,Number(amount)));break;
        case 'Levels':value=255*Math.max(0,Math.min(1,(value-black)/(white-black)))**(1/gamma);break;
        case 'Posterize':{const levels=Math.max(2,Math.min(256,Math.round(Number(amount))));value=Math.round(value/255*(levels-1))*255/(levels-1);break;}
        case 'Solarize':value=value>=Number(amount)?255-value:value;break;
        default:throw Error('Unknown adjustment: '+name);
      }
      if(c===0)r=value;else if(c===1)g=value;else b=value;
    }
    pixels[i]=clamp(r);pixels[i+1]=clamp(g);pixels[i+2]=clamp(b);
  }
  return image;
}
