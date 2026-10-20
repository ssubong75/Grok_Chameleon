const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const presets={
  zoom:{shape:[14,90,0,0,.5,0],ghosts:[[.35,10,[.6,.8,1],.18],[.6,26,[.5,1,.6],.10],[.85,6,[1,.7,.4],.25],[1.25,40,[.7,.5,1],.08],[1.5,16,[1,.6,.5],.15],[1.9,70,[.5,.7,1],.06]]},
  prime35:{shape:[12,70,90,6,.3,0],ghosts:[[.7,18,[.6,1,.7],.12],[1.4,30,[1,.7,.5],.09]]},
  prime105:{shape:[22,130,0,0,.8,0],ghosts:[[.5,14,[1,.8,.5],.12],[1.6,50,[.6,.7,1],.07]]},
  moviePrime:{shape:[10,60,0,0,.2,1],ghosts:[[.4,8,[.5,.7,1],.2],[1,20,[.4,.6,1],.12],[1.6,12,[.5,.8,1],.16]]}
};
export function lensFlare(image,settings={}){
  const {width,height,data}=image,bw=Number(settings.documentWidth)||width,bh=Number(settings.documentHeight)||height,ox=Number(settings.x)||0,oy=Number(settings.y)||0;
  const center=key=>Number.isFinite(Number(settings[key]))?clamp(Number(settings[key]),-.5,1.5):.5,cx=center('centerX')*bw,cy=center('centerY')*bh,mx=bw/2,my=bh/2,scale=Math.max(1,Math.hypot(bw,bh))/1000,brightness=clamp(Number(settings.brightness)||100,10,300)/100;
  const {shape:[core,glow,ringRadius,ringWidth,rays,streak],ghosts}=presets[settings.lens]||presets.zoom;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const fx=x+ox+.5,fy=y+oy+.5,dx=fx-cx,dy=fy-cy,d=Math.hypot(dx,dy),g=Math.exp(-((d/(core*scale))**2))+.35*Math.exp(-d/(glow*scale)),light=[g,g*.95,g*.85];
    const angle=Math.atan2(dy,dx),modulation=(Math.sin(angle*12)*.5+.5)**8+(Math.sin(angle*7+1.3)*.5+.5)**12*.6,ray=rays*modulation*Math.exp(-d/(glow*1.6*scale))*.6;
    for(let channel=0;channel<3;channel++)light[channel]+=ray;
    if(streak){const value=Math.exp(-Math.abs(dy)/(2.5*scale))*Math.exp(-Math.abs(dx)/(450*scale));light[0]+=value*.5;light[1]+=value*.7;light[2]+=value;}
    if(ringRadius)for(let channel=0;channel<3;channel++){const rd=(d-ringRadius*scale*[1.04,1,.96][channel])/(ringWidth*scale);light[channel]+=.18*Math.exp(-rd*rd);}
    for(const [position,radius,tint,strength]of ghosts){const gx=cx+(mx-cx)*position*2,gy=cy+(my-cy)*position*2,gd=Math.hypot(fx-gx,fy-gy)/(radius*scale);if(gd<1.2){const edge=gd>=1?.6+.4*gd:0;for(let channel=0;channel<3;channel++)light[channel]+=edge*strength*tint[channel];}}
    const index=(y*width+x)*4;for(let channel=0;channel<3;channel++)data[index+channel]+=clamp(light[channel]*brightness,0,1)*(255-data[index+channel]);
  }
  return image;
}
