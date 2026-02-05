import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-z0-9_.-]/gi, '_')
    .slice(0, 180);
}

function normalizeLayerName(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || base === '.' || base === '..') return null;
  return base;
}

const cfgPath = process.argv[2];
if (!cfgPath) {
  die('Usage: node process_selected.js <config.json>');
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  die(`Failed to read config: ${e instanceof Error ? e.message : String(e)}`);
}

const baseId = sanitizeName(cfg?.baseId);
const runId = sanitizeName(cfg?.runId);
if (!baseId) die('Missing config.baseId');
if (!runId) die('Missing config.runId');

const include = Array.isArray(cfg?.include)
  ? cfg.include.map(String).map((s) => s.trim()).filter(Boolean)
  : [];
if (include.length === 0) die('No layers selected (include is empty).');

const runDir = path.join(__dirname, 'output', baseId, 'runs', runId);
const runSongsDir = path.join(runDir, 'songs');
const sourceSongsDir = cfg?.sourceSongsDir
  ? path.resolve(String(cfg.sourceSongsDir))
  : path.join(__dirname, 'output', baseId, 'songs');

fs.mkdirSync(runSongsDir, { recursive: true });

console.log(`Run dir: ${runDir}`);
console.log(`Source songs: ${sourceSongsDir}`);
console.log(`Selected layers: ${include.length}`);

for (const name of include) {
  const normalized = normalizeLayerName(name);
  if (!normalized) {
    die(`Invalid layer filename: ${String(name)}`);
  }

  const exactSrc = path.join(sourceSongsDir, normalized);
  const legacySrc = path.join(sourceSongsDir, sanitizeName(normalized));
  const src = fs.existsSync(exactSrc) ? exactSrc : legacySrc;
  if (!fs.existsSync(src)) {
    die(`Missing layer file: ${exactSrc}`);
  }

  const dest = path.join(runSongsDir, normalized);
  fs.copyFileSync(src, dest);
}

fs.writeFileSync(
  path.join(runDir, 'manifest.json'),
  JSON.stringify(
    {
      include: include.map(normalizeLayerName).filter(Boolean),
      updatedAt: Date.now(),
    },
    null,
    2
  ),
  'utf8'
);

run(process.execPath, [path.join(__dirname, 'timestretch.js'), '--base-dir', runDir]);
run(process.execPath, [path.join(__dirname, 'layerer.js'), '--base-dir', runDir]);
