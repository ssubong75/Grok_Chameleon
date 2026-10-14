const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {saveAudioEdit}=require('../common/app/electron/audio-edit');
const source=fs.readFileSync(path.join(__dirname,'../common/app/web/scripts/detail_audio_edit.js'),'utf8');
function setup(){
 const fixture={target:'audio',activeAudioTrack:1,audioTracks:[1],duration:8,mediaDuration:8,selection:null,selectedClipIds:[],audioClips:[
  {id:'a1',source:'original',start:0,duration:8,inPoint:0,gain:1,trackId:1},
  {id:'a2',source:'extra',start:0,duration:5,inPoint:0,gain:1,trackId:2}],
  videoClips:[{id:'v',source:'original',start:0,duration:8,inPoint:0}],undoStack:[],redoStack:[],previewNodes:[],
  video:{pause(){}},panel:{querySelector:()=>({setAttribute(){}})}};
 const context=vm.createContext({fixture,document:{addEventListener(){}},window:{}});
 vm.runInContext(source,context);vm.runInContext(`detailAudioEditor=fixture;drawDetailAudioEditor=()=>{};refreshDetailTimeline=()=>{};presentDetailTimeline=()=>{};syncDetailAudioPreview=()=>{};paintDetailTimelineChrome=()=>{};stopDetailTimeline=()=>{};`,context);
 return {e:fixture,call:s=>vm.runInContext(s,context)};
}
test('track creation is undoable and overlapping audio on different tracks survives save',()=>{
 const {e,call}=setup();e.audioClips=e.audioClips.filter(c=>c.trackId===1);
 assert.equal(call('addDetailAudioTrack(fixture)'),2);assert.deepEqual(Array.from(e.audioTracks),[1,2]);
 call('restoreDetailAudioHistory(false)');assert.deepEqual(Array.from(e.audioTracks),[1]);
 call('restoreDetailAudioHistory(true)');assert.deepEqual(Array.from(e.audioTracks),[1,2]);
 e.audioClips.push({id:'a2',trackId:2,start:0,duration:5,inPoint:0,source:'extra',gain:1});
 assert.equal(call('detailPriorityAudioClips(fixture.audioClips)').length,2);
 assert.equal(call('serializeDetailAudioClip(fixture.audioClips[1])').trackId,2);
});
test('range deletion and hit testing are confined to the active audio track',()=>{
 const {e,call}=setup();e.activeAudioTrack=2;e.audioTracks=[1,2];e.selection={start:1,end:3,clipIds:[]};
 assert.equal(call('detailAudioClipAtTime(1,1)').id,'a1');assert.equal(call('detailAudioClipAtTime(1,2)').id,'a2');
 assert.deepEqual(Array.from(call('detailAudioTrimIds(fixture.audioClips[0])')),[]);
 call('deleteDetailAudioSelection()');
 assert.equal(e.audioClips.find(c=>c.id==='a1').duration,8);
 assert.equal(e.audioClips.filter(c=>c.trackId===2).length,2);
 assert.equal(e.videoClips[0].duration,8);
});

const ffmpeg=process.env.VIDEO_EDIT_TEST_FFMPEG || '/opt/homebrew/bin/ffmpeg';
test('saved video contains both simultaneous audio tracks', {skip:!fs.existsSync(ffmpeg)}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'grok-track-mix-'));
 const run=(args,options={})=>{const r=spawnSync(ffmpeg,['-v','error',...args],{timeout:30000,maxBuffer:4*1024*1024,...options});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;};
 try{
  const folder=path.join(root,'collection','synthetic');fs.mkdirSync(folder,{recursive:true});
  const base=path.join(folder,'base.mp4'),audio=path.join(root,'extra.m4a');
  run(['-f','lavfi','-i','testsrc2=size=160x96:rate=24:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:v','libx264','-c:a','aac',base]);
  run(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=5','-c:a','aac',audio]);
  const deps={ffmpeg,serverBase:'http://localhost',resolveSource:()=>new URL('http://localhost/api/media'),fetchJson:async u=>u.pathname==='/api/accounts'?{library_root:root}:{source_path:base}};
  const output=await saveAudioEdit({provider:'build',url:'synthetic',videoClips:[{source:'original',start:0,duration:2,inPoint:0}],audioClips:[
   {trackId:1,source:'original',start:0,duration:2,inPoint:0,gain:1},
   {trackId:2,source:audio,start:0,duration:5,inPoint:0,gain:1}]},deps);
  const probe=path.join(path.dirname(ffmpeg),process.platform==='win32'?'ffprobe.exe':'ffprobe');
  const inspect=file=>JSON.parse(spawnSync(probe,['-v','error','-show_entries','format=duration:stream=codec_type,duration','-of','json',file],{encoding:'utf8'}).stdout);
  const info=inspect(output.path);assert.ok(Number(info.format.duration)<=2.05,'long audio must not extend the saved video');
  assert.ok(info.streams.every(stream=>Number(stream.duration)<=2.05),'both streams must stop at the video end');
  const overlap=await saveAudioEdit({provider:'build',url:'synthetic',videoClips:[
   {source:'original',start:0,duration:2,inPoint:0},{source:'original',start:1,duration:1,inPoint:1}],
   audioClips:[{source:audio,start:0,duration:5,inPoint:0,gain:1}]},deps);
  assert.ok(Number(inspect(overlap.path).format.duration)<=2.05,'overlapping video timeline must also ignore the audio tail');
  const pcm=run(['-i',output.path,'-ss','0.2','-t','1','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  for(const frequency of [440,660]){
   let real=0,imag=0;const count=pcm.length/4;
   for(let i=0;i<count;i++){const sample=pcm.readFloatLE(i*4),angle=2*Math.PI*frequency*i/48000;real+=sample*Math.cos(angle);imag+=sample*Math.sin(angle);}
   const amplitude=2*Math.hypot(real,imag)/count;assert.ok(amplitude>.05,`${frequency} Hz track was not mixed: ${amplitude}`);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
