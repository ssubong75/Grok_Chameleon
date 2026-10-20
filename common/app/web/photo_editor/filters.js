import {colorLookupPixels} from './color-lookup.js';
import {hueSaturationPixels} from './hue-saturation.js';
import {retainedPhotoColor} from './photo-filter-color.js';
import {tonalBalance,colorBalancePixels} from './color-balance.js';
import {vibrancePixels} from './vibrance.js';
import {brightnessContrastPixels} from './brightness-contrast.js';
import {pointCurves} from './curve-points.js';
import {levelsPixels} from './levels.js';
import {filterGallery} from './filter-gallery.js';
import {adaptiveWideAngle} from './wide-angle.js';
import {vanishingPoint} from './vanishing-pixels.js';
import {tree} from './tree-renderer.js';
import {flame} from './flame.js';
import {pictureFrame} from './picture-frame.js';
import {extrude} from './extrude.js';
import {motionGallery} from './motion-gallery.js';
import {blurGallery} from './blur-gallery.js';
import {shapeBlur} from './shape-blur.js';
import {lensBlur} from './lens-blur.js';
import {lightingEffects} from './lighting-effects.js';
import {oilPaint} from './oil-paint.js';
import {lensCorrection} from './lens-correction.js';
import {displace} from './displace.js';
import {tiles} from './tiles.js';
import {wave} from './wave.js';
import {zigzag} from './zigzag.js';
import {shear} from './shear.js';
import {deinterlace,ntscColors} from './video-filters.js';
import {lensFlare} from './lens-flare.js';
// Pixel operations, independent of UI and browser APIs.
import {spatialFilter} from './spatial-filters.js';
import {curveTable} from './curves.js';
import {colorToAlpha} from './color-alpha.js';
import {contentAwareImage} from './content-aware.js';
import {developRaw} from './camera-raw.js';
import {reduceNoise} from './denoise.js';
import {shadowsHighlights} from './shadows-highlights.js';
import {replaceColor} from './replace-color.js';
import {hdrToning} from './hdr-toning.js';
import {matchColor} from './match-color.js';
import {autoAdjust} from './auto-adjust.js';
import {average,clouds,fibers} from './render-filters.js';
import {customFilter} from './custom-filter.js';
import {hsbHsl} from './hsb-hsl.js';
import {colorHalftone,crystallize,pointillize,mezzotint} from './color-halftone.js';
const clamp = value => Math.max(0,Math.min(255,value));
const unitClamp = value => Math.max(0,Math.min(1,value));
function hueChannel(p,q,t){if(t<0)t++;if(t>1)t--;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
function shiftHue(r,g,b,degrees){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return [r*255,g*255,b*255];const delta=max-min,s=l>.5?delta/(2-max-min):delta/(max+min);let h=max===r?(g-b)/delta+(g<b?6:0):max===g?(b-r)/delta+2:(r-g)/delta+4;h=((h/6+degrees/360)%1+1)%1;const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;return[hueChannel(p,q,h+1/3)*255,hueChannel(p,q,h)*255,hueChannel(p,q,h-1/3)*255];}
function blendLum(color){return .3*color[0]+.59*color[1]+.11*color[2];}
function clipColor(color){let output=color.slice(),lum=blendLum(output),low=Math.min(...output),high=Math.max(...output);if(low<0)output=output.map(value=>lum+(value-lum)*lum/(lum-low));low=Math.min(...output);high=Math.max(...output);if(high>1)output=output.map(value=>lum+(value-lum)*(1-lum)/(high-lum));return output.map(unitClamp);}
function setLum(color,luminosity){const shift=luminosity-blendLum(color);return clipColor(color.map(value=>value+shift));}
function colorValue(value,fallback=[.882,.827,.702]){const match=String(value||'').match(/^#([0-9a-f]{6})$/i);return match?[0,2,4].map(index=>parseInt(match[1].slice(index,index+2),16)/255):fallback;}
function blackWhiteGray(rgb,weights){const [r,g,b]=rgb,max=Math.max(r,g,b),min=Math.min(r,g,b),mid=r+g+b-max-min,primary=r>=g&&r>=b?0:g>=b?2:4,secondary=b<=r&&b<=g?1:r<=g?3:5;return unitClamp(min+(mid-min)*weights[secondary]/100+(max-mid)*weights[primary]/100);}
function mixerRow(settings,name,fallback){return ['Red','Green','Blue','Constant'].map((channel,index)=>Number.isFinite(Number(settings[name+channel]))?Number(settings[name+channel])/100:fallback[index]);}
const srgbToLinear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4,linearToSrgb=value=>value<=.0031308?value*12.92:1.055*value**(1/2.4)-.055,SRGB_TO_XYZ_D50=[[.436074,.385064,.14308],[.222504,.716878,.060618],[.013932,.097104,.714173]],XYZ_D50_TO_SRGB=[[3.133856,-1.616867,-.490615],[-.978768,1.916142,.033454],[.071945,-.228991,1.405243]],D50=[.96422,1,.82521];
function matrixVector(matrix,vector){return matrix.map(row=>row[0]*vector[0]+row[1]*vector[1]+row[2]*vector[2]);}
function photoFilterPixel(rgb,settings){const density=unitClamp(Number(settings.density)/100||0),filter=retainedPhotoColor(settings)||colorValue(settings.color,[236/255,138/255,0]),filterXyz=matrixVector(SRGB_TO_XYZ_D50,filter.map(srgbToLinear)),scale=filterXyz.map((value,index)=>1-density+density*value/D50[index]),xyz=matrixVector(SRGB_TO_XYZ_D50,rgb.map(srgbToLinear)),filtered=matrixVector(XYZ_D50_TO_SRGB,xyz.map((value,index)=>value*scale[index])).map(linearToSrgb);return settings.preserveLuminosity===false?filtered.map(unitClamp):setLum(filtered,blendLum(rgb));}
function gradientStops(value){if(Array.isArray(value))return value.map(([position,color])=>[unitClamp(Number(position)),colorValue(color)]).sort((a,b)=>a[0]-b[0]);const stops=String(value||'').split(/[\n,]+/).map(entry=>entry.trim()).filter(Boolean).map(entry=>{const match=entry.match(/^(\d+(?:\.\d+)?)\s*:\s*(#[0-9a-f]{6})$/i);if(!match)throw Error('Use gradient stops such as 0:#000000, 50:#ff0000, 100:#ffffff.');return[unitClamp(Number(match[1])/100),colorValue(match[2])];}).sort((a,b)=>a[0]-b[0]);if(stops.length<2)throw Error('Add at least two gradient stops.');return stops;}
function sampleGradient(stops,value){if(value<=stops[0][0])return stops[0][1];for(let index=1;index<stops.length;index++)if(value<=stops[index][0]){const [a,b]=[stops[index-1],stops[index]],mix=b[0]>a[0]?(value-a[0])/(b[0]-a[0]):0;return a[1].map((channel,c)=>channel+(b[1][c]-channel)*mix);}return stops.at(-1)[1];}
const bayer4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const selectiveRanges=['reds','yellows','greens','cyans','blues','magentas','whites','neutrals','blacks'];
function selectiveRow(value){const row=Array.isArray(value)?value:String(value??'0,0,0,0').split(',').map(item=>item.trim());if(row.length!==4||row.some(item=>!Number.isFinite(Number(item))))throw Error('Selective Color rows need four comma-separated values: Cyan, Magenta, Yellow, Black.');return row.map(item=>Math.max(-100,Math.min(100,Number(item))));}
function selectiveWeights(color){const max=Math.max(...color),min=Math.min(...color),mid=color[0]+color[1]+color[2]-max-min,top=index=>color[index]>=max?max-mid:0,bottom=index=>color[index]<=min?mid-min:0;return[top(0),bottom(2),top(1),bottom(0),top(2),bottom(1),Math.max(0,(min-.5)*2),unitClamp(1-Math.abs(max-.5)-Math.abs(min-.5)),Math.max(0,(.5-max)*2)];}
function selectiveColor(color,relative,adjustments){const delta=[0,0,0];for(const [range,weight] of selectiveWeights(color).entries()){if(weight<=0)continue;const adjustment=adjustments[range].map(value=>value/100);for(let channel=0;channel<3;channel++){const ink=1-color[channel],shift=adjustment[channel]+adjustment[3],scaled=relative?shift*ink:shift>0?shift*Math.min(1,2*(1-ink)):shift*Math.min(1,2*ink);delta[channel]+=scaled*weight;}}return color.map((value,index)=>unitClamp(value-delta[index]));}
function traceContour(image,settings){const {width,height,data}=image,source=new Uint8ClampedArray(data),rawLevel=Number(settings.level),level=clamp(Number.isFinite(rawLevel)?rawLevel:128),upper=settings.edge==='upper',read=(x,y,channel)=>source[(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4+channel]>level;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4;for(let channel=0;channel<3;channel++){const current=read(x,y,channel),line=current===upper&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>read(x+dx,y+dy,channel)!==current);data[index+channel]=line?0:255;}}return image;}
function windHash(x,y,channel,seed){let value=Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(channel,0xcb1ab31f)^Math.imul(seed,0x9e3779b9);value^=value>>>16;value=Math.imul(value,0x7feb352d);value^=value>>>15;value=Math.imul(value,0x846ca68b);value^=value>>>16;return(value>>>8)/16777216;}
function wind(image,settings){const {width,height,data}=image,source=new Uint8ClampedArray(data),method=['blast','stagger'].includes(settings.method)?settings.method:'wind',fromRight=settings.direction!=='fromLeft',direction=fromRight?-1:1,maximum=method==='blast'?40:method==='stagger'?12:16,seed=(Number(settings.seed)||0)>>>0,originX=Number(settings.x)||0,originY=Number(settings.y)||0,read=(x,y,channel)=>x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+channel],luminance=(x,y)=>read(x,y,0)*.299+read(x,y,1)*.587+read(x,y,2)*.114;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4,globalY=y+originY;if(method==='stagger'){const segmentLength=8+Math.floor(windHash(0,globalY,41,seed)*32),phase=Math.floor(windHash(1,globalY,42,seed)*segmentLength),segment=Math.floor(((x+originX)*direction+phase)/segmentLength),shift=Math.floor(windHash(segment,globalY,43,seed)**2*maximum),sourceX=x-direction*shift;for(let channel=0;channel<4;channel++)data[index+channel]=read(sourceX,y,channel);continue;}const strength=method==='blast'?8:4;let bestWeight=0,bestX=x;for(let step=1;step<=maximum;step++){const sourceX=x-direction*step,globalX=sourceX+originX,length=Math.max(1,windHash(globalX,globalY,44,seed)**2*maximum);if(step>length)continue;const edge=Math.min(1,Math.abs(luminance(sourceX,y)-luminance(sourceX-direction,y))/255*strength),weight=edge*(1-step/(length+1));if(weight>bestWeight){bestWeight=weight;bestX=sourceX;}}if(bestWeight>0)for(let channel=0;channel<4;channel++)data[index+channel]+= (read(bestX,y,channel)-data[index+channel])*bestWeight;}
  return image;
}
function diffuse(image,settings){const {width,height,data}=image,source=new Uint8ClampedArray(data),mode=['darkenOnly','lightenOnly','anisotropic'].includes(settings.mode)?settings.mode:'normal',seed=(Number(settings.seed)||0)>>>0,originX=Number(settings.x)||0,originY=Number(settings.y)||0,read=(x,y,channel)=>x<0||y<0||x>=width||y>=height?0:source[(y*width+x)*4+channel],lum=(pixel)=>pixel[0]*.299+pixel[1]*.587+pixel[2]*.114,readPixel=(x,y)=>[read(x,y,0),read(x,y,1),read(x,y,2),read(x,y,3)];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4,current=source.slice(index,index+4),globalX=x+originX,globalY=y+originY;if(mode==='anisotropic'){const ring=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],start=Math.floor(windHash(globalX,globalY,3,seed)*8),base=lum(current);let best=[0,0],difference=Infinity;for(let step=0;step<8;step++){const [dx,dy]=ring[(start+step)%8],next=Math.abs(lum(readPixel(x+dx,y+dy))-base);if(next<difference){difference=next;best=[dx,dy];}}const neighbour=readPixel(x+best[0],y+best[1]);for(let channel=0;channel<4;channel++)data[index+channel]=(current[channel]+neighbour[channel])*.5;continue;}const dx=Math.floor(windHash(globalX,globalY,1,seed)*3)-1,dy=Math.floor(windHash(globalX,globalY,2,seed)*3)-1,neighbour=readPixel(x+dx,y+dy);if(neighbour[3]===0&&current[3]>0&&mode!=='normal')continue;const take=mode==='darkenOnly'?lum(neighbour)<lum(current):mode==='lightenOnly'?lum(neighbour)>lum(current):true;if(take)data.set(neighbour,index);}return image;}
export function adjustPixels(image,name,amount=0){
  if(name==='Color to Alpha')return colorToAlpha(image,amount);
  if(name==='Content-Aware Fill')return contentAwareImage(image,amount);
  if(name==='Camera Raw')return developRaw(image,amount);
  if(name==='Reduce Noise')return reduceNoise(image,amount);
  if(name==='Shadows/Highlights')return shadowsHighlights(image,amount);
  if(name==='Replace Color')return replaceColor(image,amount);
  if(name==='HDR Toning')return hdrToning(image,amount);
  if(name==='Match Color')return matchColor(image,amount);
  if(['Auto Tone','Auto Contrast','Auto Color','Equalize'].includes(name))return autoAdjust(image,name);
  if(name==='Average')return average(image);
  if(name==='Clouds')return clouds(image,amount);
  if(name==='Difference Clouds')return clouds(image,amount,true);
  if(name==='Fibers')return fibers(image,amount);
  if(name==='Lens Flare')return lensFlare(image,amount);
  if(['Path Blur','Spin Blur'].includes(name))return motionGallery(image,name,amount);
  if(['Field Blur','Iris Blur','Tilt-Shift Blur'].includes(name))return blurGallery(image,name,amount);
  if(name==='Filter Gallery')return filterGallery(image,amount);
  if(name==='Adaptive Wide Angle')return adaptiveWideAngle(image,amount);
  if(name==='Vanishing Point')return vanishingPoint(image,amount);
  if(name==='Tree')return tree(image,amount);
  if(name==='Flame')return flame(image,amount);
  if(name==='Picture Frame')return pictureFrame(image,amount);
  if(name==='Extrude')return extrude(image,amount);
  if(name==='Shape Blur')return shapeBlur(image,amount);
  if(name==='Lens Blur')return lensBlur(image,amount);
  if(name==='Lighting Effects')return lightingEffects(image,amount);
  if(name==='Oil Paint')return oilPaint(image,amount);
  if(name==='Lens Correction')return lensCorrection(image,amount);
  if(name==='Displace')return displace(image,amount);
  if(name==='Tiles')return tiles(image,amount);
  if(name==='Wave')return wave(image,amount);
  if(name==='ZigZag')return zigzag(image,amount);
  if(name==='Shear')return shear(image,amount);
  if(name==='De-Interlace')return deinterlace(image,amount);
  if(name==='NTSC Colors')return ntscColors(image);
  if(name==='Custom')return customFilter(image,amount);
  if(name==='Blur More')return customFilter(image,{kernel:[0,0,0,0,0,0,1,2,1,0,0,2,2,2,0,0,1,2,1,0,0,0,0,0,0],scale:14,offset:0});
  if(name==='Sharpen'){spatialFilter(image,'Unsharp Mask',{amount:60,radius:.5,threshold:0});return image;}
  if(name==='Sharpen More')return spatialFilter(image,'Unsharp Mask',{amount:150,radius:.6,threshold:0})?image:image;
  if(name==='Sharpen Edges')return spatialFilter(image,'Unsharp Mask',{amount:100,radius:.8,threshold:6})?image:image;
  if(name==='Despeckle')return spatialFilter(image,'Surface Blur',{radius:2,threshold:12})?image:image;
  if(name==='HSB/HSL')return hsbHsl(image,amount);
  if(name==='Color Halftone')return colorHalftone(image,amount);
  if(name==='Crystallize')return crystallize(image,amount);
  if(name==='Pointillize')return pointillize(image,amount);
  if(name==='Mezzotint')return mezzotint(image,amount);
  if(name==='Trace Contour')return traceContour(image,amount);
  if(name==='Wind')return wind(image,amount);
  if(name==='Diffuse')return diffuse(image,amount);
  if(spatialFilter(image,name,amount))return image;
  const pixels=image.data;const settings=typeof amount==='object'?amount:{};
  if(name==='Black & White'){
    const weights=['reds','yellows','greens','cyans','blues','magentas'].map((key,index)=>Number.isFinite(Number(settings[key]))?Number(settings[key]):[40,60,40,60,20,80][index]),tint=settings.tint?colorValue(settings.tintColor):null;
    for(let i=0;i<pixels.length;i+=4){const gray=blackWhiteGray([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],weights),color=tint?setLum(tint,gray):[gray,gray,gray];pixels[i]=clamp(color[0]*255);pixels[i+1]=clamp(color[1]*255);pixels[i+2]=clamp(color[2]*255);}return image;
  }
  if(name==='Channel Mixer'){
    const red=mixerRow(settings,'red',[1,0,0,0]),green=mixerRow(settings,'green',[0,1,0,0]),blue=mixerRow(settings,'blue',[0,0,1,0]),gray=mixerRow(settings,'gray',[.4,.4,.2,0]),rows=settings.monochrome?[gray,gray,gray]:[red,green,blue];
    for(let i=0;i<pixels.length;i+=4){const source=[pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],mixed=rows.map(row=>unitClamp(row[0]*source[0]+row[1]*source[1]+row[2]*source[2]+row[3]));pixels[i]=clamp(mixed[0]*255);pixels[i+1]=clamp(mixed[1]*255);pixels[i+2]=clamp(mixed[2]*255);}return image;
  }
  if(name==='Photo Filter'){
    for(let i=0;i<pixels.length;i+=4){const filtered=photoFilterPixel([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],settings);pixels[i]=clamp(filtered[0]*255);pixels[i+1]=clamp(filtered[1]*255);pixels[i+2]=clamp(filtered[2]*255);}return image;
  }
  if(name==='Gradient Map'){
    const stops=gradientStops(settings.stops),reverse=Boolean(settings.reverse),dither=Boolean(settings.dither);for(let i=0;i<pixels.length;i+=4){const pixel=i/4,x=pixel%image.width,y=Math.floor(pixel/image.width);let value=blendLum([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255]);if(reverse)value=1-value;const delta=dither?(bayer4[(y%4)*4+x%4]+.5)/16/255-.5/255:0,color=sampleGradient(stops,value).map(channel=>unitClamp(channel+delta));pixels[i]=clamp(color[0]*255);pixels[i+1]=clamp(color[1]*255);pixels[i+2]=clamp(color[2]*255);}return image;
  }
  if(name==='Selective Color'){
    const adjustments=selectiveRanges.map(key=>selectiveRow(settings[key])),relative=settings.method!=='absolute';for(let i=0;i<pixels.length;i+=4){const color=selectiveColor([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],relative,adjustments);pixels[i]=clamp(color[0]*255);pixels[i+1]=clamp(color[1]*255);pixels[i+2]=clamp(color[2]*255);}return image;
  }
  if(name==='Curves'&&(settings.points?.length||settings.channels&&settings.channels!=='{}'))return pointCurves(image,settings);
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
  if(name==='Color Lookup')return colorLookupPixels(image,settings);
  if(name==='Hue/Saturation')return hueSaturationPixels(image,settings);
  if(name==='Color Balance'&&tonalBalance(settings))return colorBalancePixels(image,settings);
  if(name==='Vibrance')return vibrancePixels(image,amount);
  if(name==='Brightness/Contrast')return brightnessContrastPixels(image,settings);
  if(name==='Exposure'){
    const exposure=Number(typeof amount==='object'?settings.exposure:amount),offset=Number(settings.offset??0),gamma=Number(settings.gamma??1);
    if(![exposure,offset,gamma].every(Number.isFinite)||gamma<=0)throw Error('Invalid Exposure settings.');
    const multiplier=2**exposure,exponent=1/(2.2*Math.max(.01,gamma));
    for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]=clamp(255*Math.max(0,(pixels[i+c]/255)**2.2*multiplier+offset)**exponent);
    return image;
  }
  if(name==='Threshold'){
    const level=Math.round(Number(amount));if(!Number.isFinite(level)||level<0||level>255)throw Error('Invalid Threshold level.');
    for(let i=0;i<pixels.length;i+=4){const value=30*pixels[i]+59*pixels[i+1]+11*pixels[i+2]>100*level-50?255:0;pixels[i]=pixels[i+1]=pixels[i+2]=value;}return image;
  }
  if(name==='Levels')return levelsPixels(image,settings);
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
        case 'Color Balance':value+=Number(settings[['red','green','blue'][c]])||0;break;
        case 'Gamma':value=255*(value/255)**(1/Math.max(.01,Number(amount)));break;
        case 'Levels':value=255*Math.max(0,Math.min(1,(value-black)/(white-black)))**(1/gamma);break;
        case 'Posterize':{const levels=Math.max(2,Math.min(256,Math.round(Number(amount))));const n=Math.min(255,levels);value=Math.floor(Math.min(n-1,Math.floor(value*n/256))*255/(n-1));break;}
        case 'Solarize':value=value>=Number(amount)?255-value:value;break;
        default:throw Error('Unknown adjustment: '+name);
      }
      if(c===0)r=value;else if(c===1)g=value;else b=value;
    }
    pixels[i]=clamp(r);pixels[i+1]=clamp(g);pixels[i+2]=clamp(b);
  }
  return image;
}
