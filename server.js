import http from 'http';
import { spawn } from 'child_process';
import { spawnSync } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Busboy from 'busboy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5174);
const DEV = process.argv.includes('--dev');

function baseIdFromQuery(query) {
  return query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function methodNotAllowed(res) {
  res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}

function safeId(s) {
  return s.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'job';
}

function safeBaseId(s) {
  const out = String(s || '')
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .slice(0, 120);
  return out;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  return JSON.parse(raw);
}

function serveFile(res, absPath) {
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return notFound(res);
  }

  const ext = path.extname(absPath).toLowerCase();
  const type =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.wav'
              ? 'audio/wav'
              : ext === '.mp3'
                ? 'audio/mpeg'
                : ext === '.m4a'
                  ? 'audio/mp4'
                  : ext === '.mp4'
                    ? 'video/mp4'
                    : ext === '.json'
                      ? 'application/json; charset=utf-8'
              : 'application/octet-stream';

  res.writeHead(200, {
    'content-type': type,
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  fs.createReadStream(absPath).pipe(res);
}

function serveDir(res, dir, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return notFound(res);
  serveFile(res, abs);
}

const jobs = new Map();
let runningJobId = null;

function getChild(job) {
  return /** @type {import('child_process').ChildProcess | null} */ (
    job?._child || null
  );
}

function appendLines(job, chunk) {
  const s = chunk.toString('utf8');
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    job.logLines.push(line);
  }
  if (job.logLines.length > 500) job.logLines = job.logLines.slice(-500);
}

function computeResult(query) {
  const baseId = baseIdFromQuery(query);
  const baseDir = path.join('output', baseId);
  const outputFile = path.join(baseDir, `layered_${baseId}.wav`);
  const outputUrl = `/${outputFile.split(path.sep).join('/')}`;
  return { baseDir, outputFile, outputUrl };
}

function baseDirsFor(baseId) {
  const baseDir = path.join(__dirname, 'output', baseId);
  return {
    baseDir,
    songsDir: path.join(baseDir, 'songs'),
    manifestPath: path.join(baseDir, 'manifest.json'),
    downloadsPath: path.join(baseDir, 'downloads.json'),
  };
}

function readManifestInclude(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.include)) return null;
    const include = parsed.include
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
    return include.length ? include : null;
  } catch {
    return null;
  }
}

function writeManifestInclude(manifestPath, include) {
  const out = {
    include: (Array.isArray(include) ? include : [])
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean),
    updatedAt: Date.now(),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

function ytdlpCookiesArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  if (process.env.YTDLP_COOKIES) {
    args.push('--cookies', process.env.YTDLP_COOKIES);
  }
  return args;
}

function ytdlpSearch(query, limit, exclude) {
  const excludeQuery = (exclude || [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .map((keyword) => `-intitle:\"${keyword}\"`)
    .join(' ');
  const q = `ytsearch${limit}:${query} cover ${excludeQuery}`.trim();

  const args = [
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '5',
    '--retries',
    '3',
    '--extractor-args',
    `youtube:player_client=${process.env.YTDLP_PLAYER_CLIENTS || 'web'}`,
    ...ytdlpCookiesArgs(),
    '--flat-playlist',
    '--dump-json',
    q,
  ];

  const stdout = execFileSync('yt-dlp', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
  const lines = stdout.trim().split('\n').filter(Boolean);
  const items = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const id = String(entry?.id || entry?.url || '').trim();
      const title = String(entry?.title || '').trim();
      const url = entry?.webpage_url
        ? String(entry.webpage_url)
        : id
          ? `https://www.youtube.com/watch?v=${id}`
          : null;
      if (!id || !title || !url) continue;
      items.push({ id, title, url });
    } catch {
      // ignore bad line
    }
  }
  return items;
}

function tryCmd(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function tryCmdOut(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return String(r.stdout || '').trim();
  } catch {
    return null;
  }
}

function getHealth() {
  const ytdlpVersion = tryCmdOut('yt-dlp', ['--version']);
  return {
    ffmpeg: tryCmd('ffmpeg', ['-version']),
    ytdlp: Boolean(ytdlpVersion),
    ytdlpVersion,
    rubberband: fs.existsSync(path.join(__dirname, 'lib', 'rubberband', 'rubberband-r3')),
  };
}

function startJob({ query, download, number, exclude }) {
  const now = Date.now();
  const id = `${safeId(query)}_${now}`;
  const job = {
    id,
    status: /** @type {'running'|'success'|'error'|'stopped'} */ ('running'),
    startedAt: now,
    endedAt: null,
    logLines: [],
    result: null,
    error: null,
  };
  jobs.set(id, job);
  runningJobId = id;

  const args = [];
  if (download) {
    args.push('--download');
    if (number) args.push('--number', String(number));
    if (exclude?.length) args.push('--exclude', exclude.join(','));
  }
  args.push(query);

  job.logLines.push(`$ node main.js ${args.map((a) => JSON.stringify(a)).join(' ')}`);

  const child = spawn(process.execPath, [path.join(__dirname, 'main.js'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true, // allow killing the whole process group (yt-dlp/ffmpeg/rubberband)
  });

  Object.defineProperty(job, '_child', { value: child, enumerable: false });
  Object.defineProperty(job, '_query', { value: query, enumerable: false });

  child.stdout.on('data', (c) => appendLines(job, c));
  child.stderr.on('data', (c) => appendLines(job, c));

  child.on('close', (code) => {
    // If user stopped the job, preserve that state.
    const stopped = job.status === 'stopped';
    job.endedAt = job.endedAt ?? Date.now();
    runningJobId = runningJobId === id ? null : runningJobId;

    const { baseDir, outputFile, outputUrl } = computeResult(query);
    if (stopped) {
      if (fs.existsSync(outputFile)) job.result = { outputUrl, baseDir };
      return;
    }

    if (code === 0 && fs.existsSync(outputFile)) {
      job.status = 'success';
      job.result = { outputUrl, baseDir };
    } else {
      job.status = 'error';
      job.error = `Process exited with code ${code}`;
      job.result = fs.existsSync(outputFile) ? { outputUrl, baseDir } : null;
      job.logLines.push(job.error);
    }
  });

  return job;
}

function startDownloadJob({ baseId, items }) {
  const now = Date.now();
  const id = `${safeId(`download_${baseId}`)}_${now}`;
  const job = {
    id,
    status: /** @type {'running'|'success'|'error'|'stopped'} */ ('running'),
    startedAt: now,
    endedAt: null,
    logLines: [],
    result: null,
    error: null,
  };
  jobs.set(id, job);
  runningJobId = id;

  const { baseDir } = baseDirsFor(baseId);
  fs.mkdirSync(baseDir, { recursive: true });
  const reqPath = path.join(baseDir, `download_request_${now}.json`);
  fs.writeFileSync(reqPath, JSON.stringify({ items }, null, 2), 'utf8');

  const args = [path.join(__dirname, 'download_selected.js'), baseId, reqPath];
  job.logLines.push(`$ node download_selected.js "${baseId}" "${reqPath}"`);

  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true,
  });

  Object.defineProperty(job, '_child', { value: child, enumerable: false });
  Object.defineProperty(job, '_baseId', { value: baseId, enumerable: false });

  child.stdout.on('data', (c) => appendLines(job, c));
  child.stderr.on('data', (c) => appendLines(job, c));

  child.on('close', (code) => {
    const stopped = job.status === 'stopped';
    job.endedAt = job.endedAt ?? Date.now();
    runningJobId = runningJobId === id ? null : runningJobId;

    if (stopped) return;
    if (code === 0) {
      job.status = 'success';
      job.result = { baseDir: path.join('output', baseId) };
    } else {
      job.status = 'error';
      job.error = `Process exited with code ${code}`;
      job.logLines.push(job.error);
    }
  });

  return job;
}

function stopJobById(id) {
  const job = jobs.get(id);
  if (!job) return { ok: false, code: 404, error: 'Job not found' };
  if (job.status !== 'running') return { ok: true, code: 200, job };

  const child = getChild(job);
  job.status = 'stopped';
  job.error = 'Stopped by user';
  job.endedAt = Date.now();
  runningJobId = runningJobId === id ? null : runningJobId;
  job.logLines.push('^C stopped by user');

  if (child) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else if (!child.killed) child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 1500);
  }

  const query = job._query || null;
  const baseId = job._baseId || null;
  if (query) {
    const { baseDir, outputFile, outputUrl } = computeResult(query);
    if (fs.existsSync(outputFile)) job.result = { outputUrl, baseDir };
  } else if (baseId) {
    job.result = { baseDir: path.join('output', baseId) };
  }

  return { ok: true, code: 200, job };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = u.pathname;

  // API
  if (pathname === '/api/health') {
    if (req.method !== 'GET') return methodNotAllowed(res);
    return json(res, 200, getHealth());
  }

  if (pathname === '/api/search') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    try {
      const body = await readJson(req);
      const query = String(body?.query || '').trim();
      if (!query) return json(res, 400, { error: 'Missing query' });
      const limit = Math.max(1, Math.min(30, Number(body?.limit || 12)));
      const exclude = Array.isArray(body?.exclude)
        ? body.exclude.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      const items = ytdlpSearch(query, limit, exclude);
      return json(res, 200, { items });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (pathname === '/api/download') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    if (runningJobId) {
      return json(res, 409, { error: 'A job is already running.', id: runningJobId });
    }
    try {
      const body = await readJson(req);
      const baseId = safeBaseId(String(body?.baseId || '').trim());
      if (!baseId) return json(res, 400, { error: 'Missing baseId' });
      const items = Array.isArray(body?.items) ? body.items : [];
      const normalized = items
        .map((it) => ({
          id: String(it?.id || '').trim(),
          title: String(it?.title || '').trim(),
          url: String(it?.url || it?.webpage_url || '').trim(),
        }))
        .filter((it) => it.id && it.title && it.url)
        .slice(0, 40);
      if (normalized.length === 0) {
        return json(res, 400, { error: 'No items provided' });
      }
      const job = startDownloadJob({ baseId, items: normalized });
      return json(res, 200, { id: job.id });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (pathname === '/api/run') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    if (runningJobId) {
      return json(res, 409, { error: 'A job is already running.', id: runningJobId });
    }

    try {
      const body = await readJson(req);
      const query = String(body?.query || '').trim();
      if (!query) return json(res, 400, { error: 'Missing query' });

      const download = Boolean(body?.download);
      const number = Math.max(1, Math.min(20, Number(body?.number || 5)));
      const exclude = Array.isArray(body?.exclude)
        ? body.exclude.map(String).map((s) => s.trim()).filter(Boolean)
        : [];

      // Optional manifest write for "selected layers" support
      const baseId = safeBaseId(baseIdFromQuery(query));
      if (Array.isArray(body?.include)) {
        const { manifestPath } = baseDirsFor(baseId);
        writeManifestInclude(manifestPath, body.include);
      }

      const job = startJob({ query, download, number, exclude });
      return json(res, 200, { id: job.id });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (pathname.startsWith('/api/jobs/')) {
    const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
    if (req.method === 'POST' && pathname.endsWith('/stop')) {
      const jobId = decodeURIComponent(
        pathname.slice('/api/jobs/'.length, -'/stop'.length)
      );
      const r = stopJobById(jobId);
      if (!r.ok) return json(res, r.code, { error: r.error });
      return json(res, 200, r.job);
    }
    if (req.method !== 'GET') return methodNotAllowed(res);
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: 'Job not found' });
    return json(res, 200, job);
  }

  if (pathname === '/api/stop') {
    if (req.method !== 'POST') return methodNotAllowed(res);
    if (!runningJobId) return json(res, 200, { ok: true });
    const r = stopJobById(runningJobId);
    if (!r.ok) return json(res, r.code, { error: r.error });
    return json(res, 200, r.job);
  }

  if (pathname.startsWith('/api/manifest/')) {
    const baseId = safeBaseId(
      decodeURIComponent(pathname.slice('/api/manifest/'.length))
    );
    if (!baseId) return json(res, 400, { error: 'Missing baseId' });
    const { manifestPath } = baseDirsFor(baseId);
    if (req.method === 'GET') {
      const include = readManifestInclude(manifestPath) || [];
      return json(res, 200, { baseId, include });
    }
    if (req.method === 'POST') {
      try {
        const body = await readJson(req);
        const include = Array.isArray(body?.include) ? body.include : [];
        const saved = writeManifestInclude(manifestPath, include);
        return json(res, 200, { baseId, ...saved });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return methodNotAllowed(res);
  }

  if (pathname.startsWith('/api/songs/')) {
    if (req.method !== 'GET') return methodNotAllowed(res);
    const baseId = safeBaseId(decodeURIComponent(pathname.slice('/api/songs/'.length)));
    if (!baseId) return json(res, 400, { error: 'Missing baseId' });
    const { songsDir, manifestPath } = baseDirsFor(baseId);
    const include = readManifestInclude(manifestPath);
    const names = fs.existsSync(songsDir)
      ? fs
          .readdirSync(songsDir)
          .filter((f) => f.toLowerCase().endsWith('.mp3'))
          .slice(0, 400)
      : [];
    const files = names.map((name) => ({
      name,
      url: `/output/${baseId}/songs/${encodeURIComponent(name)}`,
      selected: include ? include.includes(name) : true,
    }));
    return json(res, 200, { baseId, songsDir, files });
  }

  if (pathname.startsWith('/api/files/')) {
    if (req.method !== 'GET') return methodNotAllowed(res);
    const baseId = safeBaseId(decodeURIComponent(pathname.slice('/api/files/'.length)));
    if (!baseId) return json(res, 400, { error: 'Missing baseId' });
    const songsDir = path.join(__dirname, 'output', baseId, 'songs');
    const files = fs.existsSync(songsDir)
      ? fs
          .readdirSync(songsDir)
          .filter((f) => f.toLowerCase().endsWith('.mp3'))
          .slice(0, 200)
      : [];
    return json(res, 200, { baseId, songsDir, files });
  }

  if (pathname.startsWith('/api/upload/')) {
    if (req.method !== 'POST') return methodNotAllowed(res);
    const baseId = safeBaseId(decodeURIComponent(pathname.slice('/api/upload/'.length)));
    if (!baseId) return json(res, 400, { error: 'Missing baseId' });

    const songsDir = path.join(__dirname, 'output', baseId, 'songs');
    fs.mkdirSync(songsDir, { recursive: true });

    const bb = Busboy({
      headers: req.headers,
      limits: { files: 30, fileSize: 1024 * 1024 * 250 },
    });

    const saved = [];
    const rejected = [];

    bb.on('file', (_field, file, info) => {
      const filename = info?.filename ? String(info.filename) : 'upload.mp3';
      const ext = path.extname(filename).toLowerCase();
      const base = path
        .basename(filename, ext)
        .replace(/[^a-z0-9_-]/gi, '_')
        .replace(/_+/g, '_')
        .slice(0, 120);

      if (ext !== '.mp3') {
        rejected.push({ filename, reason: 'Only .mp3 is supported for now.' });
        file.resume();
        return;
      }

      const dest = path.join(songsDir, `${base || 'song'}.mp3`);
      const out = fs.createWriteStream(dest);
      file.pipe(out);
      out.on('close', () => saved.push(path.basename(dest)));
    });

    bb.on('finish', () => json(res, 200, { baseId, saved, rejected }));
    bb.on('error', (e) =>
      json(res, 400, { error: e instanceof Error ? e.message : String(e) })
    );

    req.pipe(bb);
    return;
  }

  // Output files
  if (pathname.startsWith('/output/')) {
    const dir = path.join(__dirname, 'output');
    return serveDir(res, dir, pathname.replace(/^\/output\//, ''));
  }

  // UI (prod only). In dev, Vite serves the UI.
  if (!DEV) {
    const distDir = path.join(__dirname, 'ui', 'dist');
    if (pathname === '/' || pathname === '') {
      return serveFile(res, path.join(distDir, 'index.html'));
    }
    // Serve asset files; fall back to SPA entry for client routing (not used, but harmless)
    const candidate = path.join(distDir, pathname.replace(/^\/+/, ''));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveFile(res, candidate);
    }
    return serveFile(res, path.join(distDir, 'index.html'));
  }

  notFound(res);
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on http://localhost:${PORT} (${DEV ? 'dev' : 'prod'})`);
});
