const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../common/app/web/scripts/detail_audio_edit.js'), 'utf8');

function setup() {
  const fixture = {
    target:'audio', duration:12, magnetic:false, selection:null, selectedClipIds:['left'],
    audioClips:[
      {id:'left',group:'original',source:'original',start:0,inPoint:0,duration:2,gain:1,vIndex:1},
      {id:'right',group:'original',source:'original',start:4,inPoint:4,duration:2,gain:1,vIndex:1},
      {id:'other',group:'attached',source:'extra',start:8,inPoint:0,duration:2,gain:1,vIndex:2},
    ],
    videoClips:[{id:'video',group:'original',source:'original',start:0,inPoint:0,duration:8}],
    previewNodes:[],gesture:null,saving:false,undoStack:[],redoStack:[],clipboard:null,
  };
  const context=vm.createContext({fixture, document:{addEventListener(){}},window:{}});
  vm.runInContext(source,context);
  vm.runInContext(`detailAudioEditor=fixture;
    drawDetailAudioEditor=()=>{};refreshDetailTimeline=()=>{};
    syncDetailAudioPreview=()=>{};recordDetailAudioHistory=()=>{};
    captureDetailAudioHistory=()=>({});detailAudioNow=()=>12;`,context);
  return {editor:fixture,call:code=>vm.runInContext(code,context)};
}

test('Audio click and move affect one split waveform, not its group or video',()=>{
  const {editor,call}=setup();
  const ids=call('detailAudioTrimIds(fixture.audioClips[0])');
  assert.deepEqual(Array.from(ids),['left']);
  assert.deepEqual(Array.from(call('detailAudioTrimIds(fixture.videoClips[0])')),[]);
  call('applyDetailAudioShift({mode:"move",moveIds:["left"]},1)');
  assert.deepEqual(editor.audioClips.map(clip=>clip.start),[1,4,8]);
  assert.equal(editor.videoClips[0].start,0);
});

test('Click copy/paste and cut use only the selected Audio waveform',()=>{
  const {editor,call}=setup();
  call('copyDetailAudioSelection(false)');
  assert.equal(editor.clipboard.audio.length,1);assert.equal(editor.clipboard.video.length,0);
  assert.equal(editor.clipboard.audio[0].duration,2);
  call('pasteDetailAudioClipboard()');
  assert.equal(editor.audioClips.length,4);assert.equal(editor.audioClips[3].start,12);
  assert.equal(editor.audioClips[3].duration,2);assert.equal(editor.videoClips.length,1);
  call('copyDetailAudioSelection(true)');
  assert.equal(editor.audioClips.some(clip=>clip.id==='left'),false);
  assert.equal(editor.audioClips.some(clip=>clip.id==='right'),true);
  assert.equal(editor.videoClips.length,1);
});

test('Shift-drag copies one waveform; range copy and Video grouping still work',()=>{
  const {editor,call}=setup();
  const ids=call('const gesture={time:0,moveIds:["left"]};beginDetailAudioCopy(gesture);Array.from(gesture.copyIds)');
  assert.equal(ids.length,1);assert.equal(editor.audioClips.length,4);assert.equal(editor.videoClips.length,1);
  editor.selection={start:.5,end:1.5};
  call('copyDetailAudioSelection(false)');
  assert.ok(editor.clipboard.audio.every(clip=>clip.duration===1 && clip.inPoint===.5));
  assert.equal(editor.clipboard.video.length,0);
  editor.target='both';
  assert.deepEqual(Array.from(call('detailAudioTrimIds(fixture.audioClips[0])')),['left','right','video']);
});
