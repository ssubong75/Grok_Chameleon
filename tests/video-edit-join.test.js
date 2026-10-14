const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {saveAudioEdit, localAudioPeaks} = require('../common/app/electron/audio-edit');

const ffmpeg = process.env.VIDEO_EDIT_TEST_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
function run(binary, args) {
  const result = spawnSync(binary, args, {encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
test('video joins have no black frames; deliberate timeline gaps remain', {skip:!fs.existsSync(ffmpeg)}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-video-join-'));
  try {
    const card = path.join(root, 'collection', 'synthetic');
    fs.mkdirSync(card, {recursive:true});
    const base = path.join(card, 'base.mp4');
    const extra = path.join(root, 'extra.mp4');
    run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=160x96:rate=24:duration=2',
      '-f','lavfi','-i','anullsrc=r=48000:cl=stereo:d=2.05','-c:v','libx264','-c:a','aac',base]);
    run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=160x96:rate=30:duration=2','-c:v','libx264',extra]);
    const original = fs.readFileSync(base);
    const deps = {ffmpeg, serverBase:'http://localhost', resolveSource:() => new URL('http://localhost/api/media'),
      fetchJson:async url => url.pathname === '/api/accounts' ? {library_root:root} : {source_path:base}};
    const info = await localAudioPeaks(base, deps);
    assert.equal(info.duration, 2, 'video duration must not include the longer AAC track');
    for (const scenario of [
      {name:'exact join',length:2,gap:0},
      {name:'old container length',length:2.05,gap:0},
      {name:'trim at a fractional frame',length:1.05,gap:0},
      {name:'deliberate half-second gap',length:2,gap:.5},
    ]) {
      const start = scenario.length + scenario.gap;
      const payload = {provider:'build', url:'synthetic',
        videoClips:[{source:'original',start:0,inPoint:0,duration:scenario.length},
          {source:extra,start,inPoint:0,duration:2}],
        audioClips:[{source:'original',start:0,inPoint:0,duration:scenario.length,gain:1}]};
      const saved = await saveAudioEdit(payload, deps);
      const detect = run(ffmpeg, ['-hide_banner','-i',saved.path,'-vf','blackdetect=d=0.01:pix_th=0.1','-an','-f','null','-']);
      const black = [...detect.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)];
      if (scenario.gap) {
        assert.equal(black.length,1,scenario.name);
        assert.ok(Math.abs(Number(black[0][3]) - scenario.gap) < 1/24, detect.stderr);
      } else assert.equal(black.length,0,scenario.name + ': ' + detect.stderr);
      const metadata = JSON.parse(run(ffprobe,['-v','error','-select_streams','v:0','-count_frames',
        '-show_entries','stream=nb_read_frames,duration','-of','json',saved.path]).stdout).streams[0];
      const expectedFrames = Math.min(48, Math.ceil(scenario.length*24-1e-7)) + Math.round(scenario.gap*24) + 48;
      assert.equal(Number(metadata.nb_read_frames),expectedFrames,scenario.name);
      const frames = JSON.parse(run(ffprobe,['-v','error','-select_streams','v:0','-show_frames',
        '-show_entries','frame=best_effort_timestamp_time','-of','json',saved.path]).stdout).frames;
      for(let i=1;i<frames.length;i++) assert.ok(Math.abs(Number(frames[i].best_effort_timestamp_time)-Number(frames[i-1].best_effort_timestamp_time)-1/24)<.00001);
      console.log(scenario.name + ': passed');
    }
    // Moving frames, not a still-color test: an old AAC/container tail must
    // neither add repeated final frames nor delay the second video's motion.
    const joined = await saveAudioEdit({provider:'build',url:'synthetic',
      videoClips:[{source:'original',start:0,inPoint:0,duration:2.05},
        {source:base,start:2.05,inPoint:0,duration:2.05}],
      audioClips:[{source:'original',start:0,inPoint:0,duration:2.05,gain:1},
        {source:base,start:2.05,inPoint:0,duration:2.05,gain:1}]},deps);
    function pixels(file) {
      const result=spawnSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0','-an','-pix_fmt','gray','-f','rawvideo','pipe:1'],{maxBuffer:8*1024*1024});
      assert.equal(result.status,0,result.stderr?.toString());return result.stdout;
    }
    const sourcePixels=pixels(base),joinedPixels=pixels(joined.path),frameSize=160*96;
    assert.equal(joinedPixels.length,96*frameSize,'no extra held frames for two 48-frame videos');
    const difference=(a,ai,b,bi)=>{
      let sum=0;for(let i=0;i<frameSize;i++)sum+=Math.abs(a[ai*frameSize+i]-b[bi*frameSize+i]);return sum/frameSize;
    };
    assert.ok(difference(sourcePixels,47,joinedPixels,47)<8,'last real frame must be retained');
    assert.ok(difference(sourcePixels,0,joinedPixels,48)<8,'next video must begin immediately at frame 48');
    assert.ok(difference(sourcePixels,1,joinedPixels,49)<8,'next video must advance to its second frame');
    assert.ok(difference(joinedPixels,47,joinedPixels,48)>3,'join must not hold the previous frame');
    const audio=JSON.parse(run(ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=duration,sample_rate','-of','json',joined.path]).stdout).streams[0];
    assert.equal(audio.sample_rate,'48000');assert.ok(Math.abs(Number(audio.duration)-4)<.05,'audio must follow four seconds of video');
    console.log('Moving-frame boundary and audio timing: passed');
    assert.deepEqual(fs.readFileSync(base), original, 'source file must be preserved');
  } finally {fs.rmSync(root, {recursive:true,force:true});}
});
