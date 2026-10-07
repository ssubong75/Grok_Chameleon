const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const REVISION = 'card-640-v1';
const VIDEO_REVISION = 'ffmpeg-first-frame-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const mediaPattern = /\.(?:jpg|jpeg|png|webp|gif|bmp|avif|heic|heif|m4v|mov|mp4|webm)$/i;
const directories = ['previews/build/cards', 'previews/build/thumbnails', 'cache/card-previews'];

function safeFile(root, relative) {
  const absoluteRoot = fs.realpathSync(root);
  const candidate = path.resolve(absoluteRoot, relative);
  if (!candidate.startsWith(absoluteRoot + path.sep)) throw Error('Unsafe preview sync path');
  let current = candidate;
  while (current !== absoluteRoot) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('Preview sync refuses symbolic links'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    current = path.dirname(current);
  }
  return candidate;
}

function previewNames(root, relative) {
  try { return fs.readdirSync(safeFile(root, relative)).filter(name => /^[a-f0-9]{64}\.jpg$/.test(name)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function previewPaths(relative, stat) {
  const rel = relative.replace(/\\/g, '/').normalize('NFC');
  let raw = `${rel}\0${stat.mtimeNs}\0${stat.size}`;
  if (/\.(?:m4v|mov|mp4|webm)$/i.test(rel)) raw = `${VIDEO_REVISION}\0${raw}`;
  const sourceKey = hash(raw);
  if (/^(created|collection|reference)\//.test(rel)) {
    return [`previews/build/cards/${hash(`${REVISION}\0${sourceKey}`)}.jpg`, `previews/build/thumbnails/${sourceKey}.jpg`];
  }
  return [`cache/card-previews/${hash(`${REVISION}\0${sourceKey}\0card`)}.jpg`, `cache/card-previews/${hash(`${sourceKey}\0thumbnail`)}.jpg`];
}

// Snapshots contain only file metadata and hashes already read by the original sync.
function snapshotPreviews(root, records) {
  let compatible = false;
  try { compatible = fs.readFileSync(safeFile(root, 'cache/card-preview-render-revision'), 'utf8').trim() === REVISION; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = new Set(directories.flatMap(dir => previewNames(root, dir).map(name => `${dir}/${name}`)));
  const media = new Map();
  for (const [key, record] of records) {
    if (!mediaPattern.test(record.relativePath)) continue;
    const relative = record.diskRelativePath || record.relativePath;
    try {
      const stat = fs.statSync(safeFile(root, relative), { bigint: true });
      if (!stat.isFile() || Number(stat.size) !== record.size || Math.abs(Number(stat.mtimeNs) / 1e6 - record.mtimeMs) > 0.001) continue;
      media.set(key, { ...record, relative, stat, previews: previewPaths(relative, stat) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { root, compatible, files, media };
}

async function copyPreview(source, destination, signal) {
  if (signal?.aborted) throw signal.reason || Error('Preview sync cancelled');
  try {
    const stat = await fs.promises.stat(source);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 10 * 1024 * 1024) return false;
    try { if ((await fs.promises.stat(destination)).size > 0) return false; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${crypto.randomUUID()}.part`;
    try {
      await fs.promises.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
      if (signal?.aborted) throw signal.reason || Error('Preview sync cancelled');
      await fs.promises.rename(temporary, destination);
      return true;
    } finally { await fs.promises.unlink(temporary).catch(() => {}); }
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function syncPreviewSnapshots(left, right, finalRecords, { signal, conflictKeys = new Set() } = {}) {
  let copied = 0;
  // Only initialize a missing marker on an empty cache; never bless an older revision.
  for (const target of [left, right]) {
    if (!target.compatible && target.files.size === 0) {
      const marker = safeFile(target.root, 'cache/card-preview-render-revision');
      try {
        await fs.promises.mkdir(path.dirname(marker), { recursive: true });
        await fs.promises.writeFile(marker, `${REVISION}\n`, { flag: 'wx' });
        target.compatible = true;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  for (const [source, target] of [[left, right], [right, left]]) {
    if (!source.compatible || !target.compatible) continue;
    for (const [key, record] of source.media) {
      if (conflictKeys.has(key) || finalRecords.get(key)?.sha256 !== record.sha256) continue;
      const targetRecord = target.media.get(key);
      const relative = targetRecord?.relative || record.relative;
      const sourceFile = safeFile(source.root, record.relative);
      const targetFile = safeFile(target.root, relative);
      let sourceStat, targetStat;
      try {
        sourceStat = fs.statSync(sourceFile, { bigint: true });
        targetStat = fs.statSync(targetFile, { bigint: true });
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (sourceStat.mtimeNs !== record.stat.mtimeNs || sourceStat.size !== record.stat.size || targetStat.size !== sourceStat.size) continue;
      // Original sync verified copied bytes. An unchanged destination must match its snapshot.
      if (targetRecord?.sha256 === record.sha256 && (targetStat.mtimeNs !== targetRecord.stat.mtimeNs || targetStat.size !== targetRecord.stat.size)) continue;
      const destinationPreviews = previewPaths(relative, targetStat);
      for (let index = 0; index < record.previews.length; index++) {
        const sourcePreview = record.previews[index];
        if (!source.files.has(sourcePreview)) continue;
        if (await copyPreview(safeFile(source.root, sourcePreview), safeFile(target.root, destinationPreviews[index]), signal)) copied++;
      }
    }
    // Remote previews already use platform-independent identity hashes. Merge by addition.
    for (const relative of source.files) {
      if (!relative.startsWith('cache/card-previews/')) continue;
      if (await copyPreview(safeFile(source.root, relative), safeFile(target.root, relative), signal)) copied++;
    }
  }
  return { copied };
}

module.exports = { snapshotPreviews, syncPreviewSnapshots, previewPaths };
