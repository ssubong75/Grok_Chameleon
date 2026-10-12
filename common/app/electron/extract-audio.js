const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

async function extractAudio(payload, deps) {
  if (!deps.ffmpeg) throw new Error('FFmpeg를 찾을 수 없습니다.');
  if (!['build', 'imagine'].includes(payload.provider)) throw new Error('Invalid provider.');
  const { uniqueStampedName, stampStem, resolveEditInput } = require('./audio-edit');
  const resolved = await resolveEditInput(payload, deps);
  const input = resolved.input;
  const localPath = resolved.localPath;
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
        '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '128k', temp],
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
