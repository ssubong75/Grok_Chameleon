const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

async function extractAudio(payload, deps) {
  if (!deps.ffmpeg) throw new Error('FFmpeg를 찾을 수 없습니다.');
  if (!['build', 'imagine'].includes(payload.provider)) throw new Error('Invalid provider.');
  const { uniqueStampedName, stampStem, resolveEditInput, audioSourcePath } = require('./audio-edit');
  const resolved = await resolveEditInput(payload, deps);
  const input = resolved.input;
  const localPath = resolved.localPath;
  let editArgs = [], audioMap = '0:a:0', outputArgs = [];
  if (Object.hasOwn(payload, 'audioClips')) {
    if (!Array.isArray(payload.audioClips) || !payload.audioClips.length || payload.audioClips.length > 10000) throw new Error('추출할 오디오 클립이 없습니다.');
    const clips = payload.audioClips.map(clip => {
      const start = Number(clip.start), inPoint = Number(clip.inPoint), duration = Number(clip.duration), gain = clip.gain == null ? 1 : Number(clip.gain);
      if (![start, inPoint, duration, gain].every(Number.isFinite) || start < 0 || inPoint < 0 || duration <= 0 || gain < 0 || gain > 4) throw new Error('오디오 클립 구간이 올바르지 않습니다.');
      return {...clip, start, inPoint, duration, gain};
    });
    const origin = Math.min(...clips.map(c => c.start));
    const duration = Math.max(...clips.map(c => c.start + c.duration)) - origin;
    const sources = [], filters = [], labels = [];
    clips.forEach((clip, index) => {
      const source = audioSourcePath(clip);
      if (source && !sources.includes(source)) sources.push(source);
      const inputIndex = source ? sources.indexOf(source) + 1 : 0;
      const delay = Math.max(0, Math.round((clip.start - origin) * 48000));
      filters.push(`[${inputIndex}:a:0]atrim=start=${clip.inPoint.toFixed(9)}:duration=${clip.duration.toFixed(9)},asetpts=PTS-STARTPTS,aresample=48000,volume=${clip.gain.toFixed(6)},adelay=${delay}S:all=1[a${index}]`);
      labels.push(`[a${index}]`);
    });
    filters.push(`aevalsrc=0:channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(9)}[sil]`);
    filters.push(`[sil]${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`);
    editArgs = sources.flatMap(source => ['-i', source]);
    editArgs.push('-filter_complex', filters.join(';'));
    audioMap = '[aout]';
    outputArgs = ['-t', duration.toFixed(9)];
  }
  let target;
  if (payload.provider === 'build') {
    if (!localPath) throw new Error('빌드 영상의 로컬 파일을 찾을 수 없습니다.');
    target = path.join(path.dirname(localPath), uniqueStampedName(path.dirname(localPath), 'm4a'));
  } else {
    const selected = await deps.dialog.showSaveDialog(deps.window, {
      title: '오디오 저장 위치', defaultPath: stampStem() + '.m4a',
      filters: [{name: 'M4A 오디오', extensions: ['m4a']}],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (selected.canceled || !selected.filePath) return {cancelled: true};
    target = selected.filePath;
    if (!/\.m4a$/i.test(target)) target += '.m4a';
    // Only replace the exact file confirmed in the native save dialog.
    if (target !== selected.filePath && fs.existsSync(target)) throw new Error('같은 이름의 오디오 파일이 이미 있습니다.');
  }
  const temp = path.join(path.dirname(target), '.' + path.basename(target) + '.' + crypto.randomUUID() + '.m4a');
  try {
    await new Promise((resolve, reject) => {
      execFile(deps.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-i', input, ...editArgs, '-map', audioMap, '-vn', '-sn', '-dn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '128k', ...outputArgs, temp],
      {timeout: 600000, maxBuffer: 1024 * 1024, windowsHide: true}, (error, stdout, stderr) => {
        if (!error) return resolve();
        reject(new Error(/matches no streams|does not contain any stream/i.test(stderr)
          ? '이 영상에는 추출할 오디오가 없습니다.' : '오디오 추출에 실패했습니다. ' + String(stderr || error.message).slice(-600)));
      });
    });
    if (payload.provider === 'build') {
      // Exclusive copy protects an existing result even if a second request raced us.
      await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
    } else {
      await fs.promises.rename(temp, target);
    }
    return {cancelled: false, path: target};
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}
module.exports = {extractAudio};
