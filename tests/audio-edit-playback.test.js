const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../common/app/web/scripts/detail_audio_edit.js'),'utf8');
function setup(){
 let frame;
 const media={currentTime:0,paused:true,readyState:4,ended:false,loop:true,classList:{remove(){},add(){}},
  play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};
 const fixture={duration:10,mediaDuration:2,time:0,running:false,video:media,
  videoClips:[{id:'v',source:'original',start:0,duration:2,inPoint:0}],
  audioClips:[{id:'a',start:0,duration:10,inPoint:0}],previewNodes:[],
  picture:{pause(){},classList:{remove(){}}},panel:{querySelector:()=>null},
  player:{querySelector:()=>({value:'1'})}};
 const context=vm.createContext({fixture,document:{addEventListener(){},activeElement:null},window:{},
  requestAnimationFrame:callback=>{frame=callback;return 1;},cancelAnimationFrame(){},performance:{now:()=>0}});
 vm.runInContext(source,context);vm.runInContext('detailAudioEditor=fixture;drawDetailAudioEditor=()=>{};syncDetailAudioPreview=()=>{};paintDetailTimelineChrome=()=>{};',context);
 return {e:fixture,call:s=>vm.runInContext(s,context),tick:time=>frame(time),context};
}
test('playback end ignores longer audio; reaching the video end loops to zero',()=>{
 const {e,call,tick}=setup();assert.equal(call('detailPlayEnd(fixture)'),2);
 call('startDetailTimeline(fixture)');assert.equal(e.running,true);assert.equal(e.video.loop,false);
 e.time=1.98;e.video.currentTime=2;e.video.ended=true;tick(2000);
 assert.equal(e.time,0);assert.equal(e.video.currentTime,0);assert.equal(e.running,true);
 call('stopDetailTimeline(fixture)');assert.equal(e.running,false);assert.equal(e.video.paused,true);
});
test('Space toggles repeatedly including seek-slider focus, without key-repeat toggles',()=>{
 const {e,call,context}=setup();let prevented=0,stopped=0;
 context.event={code:'Space',key:' ',repeat:false,target:{closest:()=>null},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++};
 for(let i=0;i<6;i++){call('handleDetailAudioKey(event)');assert.equal(e.running,i%2===0);}
 assert.equal(prevented,6);assert.equal(stopped,6);
 context.event.repeat=true;call('handleDetailAudioKey(event)');assert.equal(e.running,false);
 context.event.repeat=false;context.event.target.closest=selector=>selector==='input, textarea, [contenteditable=\'true\']'?{}:null;
 call('handleDetailAudioKey(event)');assert.equal(e.running,true);
});
