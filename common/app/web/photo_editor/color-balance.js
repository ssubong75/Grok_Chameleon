// PhotoCraft compose/src/adjust.rs color_balance_channel and balance_gamma.
export const balanceTones=['shadows','midtones','highlights'];
export const balanceChannels=['Red','Green','Blue'];
export function tonalBalance(amount){return balanceTones.some(tone=>balanceChannels.some(channel=>Object.hasOwn(amount||{},tone+channel)));}
export function colorBalanceSettings(amount={}){
  const settings={preserveLuminosity:amount.preserveLuminosity!==false};
  for(const tone of balanceTones)for(const channel of balanceChannels){const key=tone+channel,value=Number(amount[key]??0);if(!Number.isFinite(value)||Math.abs(value)>100)throw Error('Color Balance values must be between -100 and 100.');settings[key]=value;}return settings;
}
function gammaCurve(u,gamma){
  const e=1/Math.max(.01,gamma),power=u**e;if(gamma<=1)return power;
  const slope=2**gamma,u0=Math.min(1,2*slope**(1/(e-1)));if(Number.isNaN(u0)||u0<=0||u>=u0)return power;
  const p=u0**e,d=e*u0**(e-1),t=u/u0,t2=t*t,t3=t2*t;
  return Math.max(0,Math.min(1,(t3-2*t2+t)*u0*slope+(3*t2-2*t3)*p+(t3-t2)*u0*d));
}
export function colorBalancePixels(image,amount){
  const settings=colorBalanceSettings(amount),[shadows,midtones,highlights]=balanceTones.map(tone=>balanceChannels.map(channel=>settings[tone+channel]));
  const tables=balanceChannels.map((_,channel)=>{
    const preserve=settings.preserveLuminosity,black=preserve?Math.max(...shadows)-shadows[channel]:Math.max(0,-shadows[channel]),white=preserve?highlights[channel]-Math.min(...highlights):Math.max(0,highlights[channel]),m=preserve?midtones[channel]-(Math.max(...midtones)+Math.min(...midtones))/2:midtones[channel]+(shadows[channel]+highlights[channel])/2,b=black/255,w=1-white/255,gamma=2**(m/100);
    return Uint8ClampedArray.from({length:256},(_,i)=>{const v=i/255;return v>=w?255:v<=b?0:gammaCurve((v-b)/(w-b),gamma)*255;});
  });
  const pixels=image.data;for(let i=0;i<pixels.length;i+=4)for(let channel=0;channel<3;channel++)pixels[i+channel]=tables[channel][pixels[i+channel]];return image;
}
