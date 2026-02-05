import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'songlayerer.sqlite');

function sqlValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

function runSql({ sql, params = {}, json = false }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const args = [];
  if (json) args.push('-json');
  args.push('-batch', DB_PATH);
  // Avoid emitting JSON output for pragmas when `-json` is enabled.
  if (!json) {
    args.push('-cmd', 'PRAGMA journal_mode=WAL;');
    args.push('-cmd', 'PRAGMA synchronous=NORMAL;');
    args.push('-cmd', 'PRAGMA busy_timeout=5000;');
  }
  args.push('-cmd', '.param init');
  for (const [k, v] of Object.entries(params)) {
    args.push('-cmd', `.param set $${k} ${sqlValue(v)}`);
  }
  args.push(sql);

  const r = spawnSync('sqlite3', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    throw new Error(msg || `sqlite3 failed (code ${r.status})`);
  }
  return (r.stdout || '').trim();
}

function init() {
  runSql({
    sql: `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  query TEXT,
  base_id TEXT,
  mode TEXT,
  options_json TEXT,
  selected_json TEXT,
  include_json TEXT,
  output_url TEXT,
  output_file TEXT,
  status TEXT NOT NULL,
  error TEXT,
  log_text TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs(created_at DESC);
    `.trim(),
  });
}

function insertRun(run) {
  runSql({
    sql: `
INSERT INTO runs (
  id, kind, query, base_id, mode,
  options_json, selected_json, include_json,
  output_url, output_file,
  status, error, log_text,
  created_at, ended_at
) VALUES (
  $id, $kind, $query, $base_id, $mode,
  $options_json, $selected_json, $include_json,
  $output_url, $output_file,
  $status, $error, $log_text,
  $created_at, $ended_at
);
    `.trim(),
    params: run,
  });
}

function updateRun(patch) {
  const cols = [
    'status',
    'error',
    'log_text',
    'output_url',
    'output_file',
    'ended_at',
    'options_json',
    'selected_json',
    'include_json',
    'mode',
  ];
  const sets = cols
    .filter((c) => Object.prototype.hasOwnProperty.call(patch, c))
    .map((c) => `${c} = $${c}`);
  if (sets.length === 0) return;
  runSql({
    sql: `UPDATE runs SET ${sets.join(', ')} WHERE id = $id;`,
    params: patch,
  });
}

function listRuns(limit = 20) {
  const out = runSql({
    sql: `
SELECT id, kind, query, base_id, mode, status, error, output_url, created_at, ended_at
FROM runs
ORDER BY created_at DESC
LIMIT $limit;
    `.trim(),
    params: { limit },
    json: true,
  });
  return out ? JSON.parse(out) : [];
}

function getRun(id) {
  const out = runSql({
    sql: `SELECT * FROM runs WHERE id = $id LIMIT 1;`,
    params: { id },
    json: true,
  });
  const rows = out ? JSON.parse(out) : [];
  return rows[0] || null;
}

init();

export const db = {
  path: DB_PATH,
  insertRun,
  updateRun,
  listRuns,
  getRun,
};
