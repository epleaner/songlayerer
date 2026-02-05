import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeBaseId(s) {
  return String(s || '')
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .slice(0, 120);
}

function sanitizeFilename(filename) {
  return String(filename || '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function cookiesArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  if (process.env.YTDLP_COOKIES) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
  }
  return args;
}

function ytDlpCommonArgs() {
  return [
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '5',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-args',
    `youtube:player_client=${process.env.YTDLP_PLAYER_CLIENTS || 'web'}`,
    ...cookiesArgs(),
  ];
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function loadDownloadsMap(downloadsPath) {
  if (!fs.existsSync(downloadsPath)) return { items: [] };
  try {
    const parsed = readJson(downloadsPath);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  } catch {
    // ignore
  }
  return { items: [] };
}

function hasDownloaded(downloads, id) {
  return downloads.items.some((x) => x && x.id === id && x.file);
}

function existingFileOk(songsDir, file) {
  if (!file) return false;
  const abs = path.join(songsDir, file);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
}

function downloadOne({ url, outTemplate }) {
  const args = [
    ...ytDlpCommonArgs(),
    '-f',
    'bestaudio[protocol!*=m3u8][ext=m4a]/bestaudio[protocol!*=m3u8]/bestaudio/best',
    '--downloader',
    'ffmpeg',
    '--hls-prefer-ffmpeg',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
    '-o',
    outTemplate,
    url,
  ];
  execFileSync('yt-dlp', args, { stdio: 'inherit' });
}

function usage() {
  console.error('Usage: node download_selected.js <baseId> <items.json>');
  process.exit(2);
}

const baseId = safeBaseId(process.argv[2]);
const itemsPath = process.argv[3];
if (!baseId || !itemsPath) usage();

const payload = readJson(itemsPath);
const items = Array.isArray(payload?.items) ? payload.items : [];
if (items.length === 0) {
  console.error('No items to download');
  process.exit(1);
}

const baseDir = path.join(__dirname, 'output', baseId);
const songsDir = path.join(baseDir, 'songs');
ensureDir(songsDir);

const downloadsPath = path.join(baseDir, 'downloads.json');
const downloads = loadDownloadsMap(downloadsPath);

let ok = 0;
for (let i = 0; i < items.length; i++) {
  const it = items[i] || {};
  const id = String(it.id || '').trim();
  const url = String(it.url || it.webpage_url || '').trim();
  const title = sanitizeFilename(it.title || id || url);
  if (!id || !url) continue;

  if (hasDownloaded(downloads, id)) {
    const prev = downloads.items.find((x) => x.id === id);
    if (prev && existingFileOk(songsDir, prev.file)) {
      console.log(`Skipping already-downloaded: ${title}`);
      ok += 1;
      continue;
    }
  }

  const stem = `${String(i + 1).padStart(2, '0')}_${id}_${title}`;
  const outTemplate = path.join(songsDir, `${stem}.%(ext)s`);
  console.log(`Downloading ${i + 1}/${items.length}: ${title}`);

  try {
    downloadOne({ url, outTemplate });
    const outFile = `${stem}.mp3`;
    if (existingFileOk(songsDir, outFile)) {
      downloads.items = downloads.items.filter((x) => x.id !== id);
      downloads.items.push({ id, title, url, file: outFile });
      ok += 1;
    } else {
      console.warn(`Downloaded, but mp3 not found for: ${title}`);
    }
  } catch (e) {
    console.error(`Error downloading ${title}:`, e?.message || String(e));
  }
}

writeJson(downloadsPath, downloads);

if (ok <= 0) {
  console.error('Download step failed (0 songs).');
  process.exit(1);
}

console.log(`Downloaded/available: ${ok}/${items.length}`);

