const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

async function extractAudio(payload, deps) {
  if (!deps.ffmpeg) throw new Error('FFmpeg를 찾을 수 없습니다.');
  if (!['build', 'imagine'].includes(payload.provider)) throw new Error('Invalid provider.');
  const source = deps.resolveSource(payload.url);
  let input = source.href;
  let localPath = '';
  if (source.pathname === '/api/media') {
    const infoUrl = new URL('/api/card-preview/source-info', deps.serverBase);
    infoUrl.search = source.search;
    const info = await deps.fetchJson(infoUrl, {signal: AbortSignal.timeout(10000)});
    localPath = String(info.source_path || '');
    if (!path.isAbsolute(localPath) || !fs.statSync(localPath).isFile()) throw new Error('영상 파일을 찾을 수 없습니다.');
    input = localPath;
  }
  let target;
  if (payload.provider === 'build') {
    if (!localPath) throw new Error('빌드 영상의 로컬 파일을 찾을 수 없습니다.');
    target = path.join(path.dirname(localPath), path.parse(localPath).name + '.m4a');
    if (fs.existsSync(target)) throw new Error('같은 이름의 오디오 파일이 이미 있습니다: ' + target);
  } else {
    const name = path.parse(path.basename(String(payload.name || 'video'))).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'video';
    const selected = await deps.dialog.showSaveDialog(deps.window, {
      title: '오디오 저장 위치', defaultPath: name + '.m4a',
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
        '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'aac', '-b:a', '192k', temp],
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
