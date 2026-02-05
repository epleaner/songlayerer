import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';

type JobStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped';
type Mode = 'download' | 'local';

type JobResponse = {
  id: string;
  status: JobStatus;
  startedAt: number | null;
  endedAt: number | null;
  logLines: string[];
  result?: { outputUrl?: string; baseDir?: string } | null;
  error?: string | null;
};

type Health = {
  ffmpeg: boolean;
  ytdlp: boolean;
  rubberband: boolean;
  ytdlpVersion?: string | null;
};

type RunSummary = {
  id: string;
  kind: 'download' | 'process';
  query: string | null;
  base_id: string | null;
  mode: Mode | null;
  status: JobStatus;
  error: string | null;
  output_url: string | null;
  created_at: number;
  ended_at: number | null;
};

type SearchItem = {
  id: string;
  title: string;
  url: string;
};

type SongFile = {
  name: string;
  url: string;
  selected: boolean;
};

type SongsResponse = {
  baseId: string;
  songsDir: string;
  files: SongFile[];
};

type RunDetail = RunSummary & {
  options: { number?: number; exclude?: string[]; download?: boolean } | null;
  selected: SearchItem[] | null;
  include: string[] | null;
  log_text: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) throw new Error(String(parsed.error));
    } catch {
      // ignore
    }
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

function baseIdFromQuery(query: string) {
  return query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function youtubeIdFromUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch {
    // ignore
  }
  return null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('download');
  const [query, setQuery] = useState('');
  const [number, setNumber] = useState(5);
  const [exclude, setExclude] = useState('');

  const [health, setHealth] = useState<Health | null>(null);
  const [songs, setSongs] = useState<SongsResponse | null>(null);

  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const logRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const baseId = useMemo(() => baseIdFromQuery(query.trim()), [query]);

  const excludeList = useMemo(() => {
    return exclude
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [exclude]);

  const status: JobStatus = job?.status || (busy ? 'running' : 'idle');
  const logText = (job?.logLines || []).join('\n');

  const selectedSearch = useMemo(() => {
    return searchItems.filter((it) => selectedIds[it.id]);
  }, [searchItems, selectedIds]);

  const selectedSongFiles = useMemo(() => {
    return (songs?.files || []).filter((f) => f.selected);
  }, [songs]);

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function poll(id: string) {
    const next = await api<JobResponse>(`/api/jobs/${encodeURIComponent(id)}`);
    setJob(next);
    if (next.status !== 'running') {
      setBusy(false);
      stopPolling();
      // refresh file list after jobs that might have produced output
      if (baseId) {
        api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}`)
          .then(setSongs)
          .catch(() => {});
      }
      api<{ runs: RunSummary[] }>('/api/runs?limit=30')
        .then((r) => setRuns(r.runs))
        .catch(() => {});
    }
    return next;
  }

  useEffect(() => stopPolling, []);

  useEffect(() => {
    api<Health>('/api/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    api<{ runs: RunSummary[] }>('/api/runs?limit=30')
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (!baseId) {
      setSongs(null);
      return;
    }
    api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}`)
      .then(setSongs)
      .catch(() => setSongs(null));
  }, [baseId]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (status === 'running') el.scrollTop = el.scrollHeight;
  }, [job?.logLines?.length, status]);

  async function onStop() {
    setError(null);
    stopPolling();
    try {
      const stopped = jobId
        ? await api<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}/stop`, {
            method: 'POST',
          })
        : await api<JobResponse>('/api/stop', { method: 'POST' });
      setJob(stopped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSongs() {
    if (!baseId) return;
    const next = await api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}`);
    setSongs(next);
  }

  async function persistInclude(nextFiles: SongFile[]) {
    if (!baseId) return;
    const include = nextFiles.filter((f) => f.selected).map((f) => f.name);
    await api(`/api/manifest/${encodeURIComponent(baseId)}`, {
      method: 'POST',
      body: JSON.stringify({ include }),
    });
  }

  async function onToggleSong(name: string) {
    if (!songs) return;
    const nextFiles = songs.files.map((f) =>
      f.name === name ? { ...f, selected: !f.selected } : f
    );
    setSongs({ ...songs, files: nextFiles });
    try {
      await persistInclude(nextFiles);
    } catch {
      // ignore
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter a search query.');
      return;
    }
    try {
      const limit = Math.max(6, Math.min(30, Number(number) * 4));
      const res = await api<{ items: SearchItem[] }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query: trimmed, limit, exclude: excludeList }),
      });
      setSearchItems(res.items);
      const nextSel: Record<string, boolean> = {};
      for (let i = 0; i < res.items.length; i++) {
        if (i < Number(number)) nextSel[res.items[i].id] = true;
      }
      setSelectedIds(nextSel);
      setPreviewUrl(res.items[0]?.url || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDownloadSelected() {
    setError(null);
    if (!baseId) return;
    if (selectedSearch.length === 0) {
      setError('Select at least one result.');
      return;
    }
    setBusy(true);
    setJob(null);
    setJobId(null);
    stopPolling();

    try {
      const started = await api<{ id: string }>('/api/download', {
        method: 'POST',
        body: JSON.stringify({
          baseId,
          query: query.trim(),
          number,
          exclude: excludeList,
          items: selectedSearch,
        }),
      });
      setJobId(started.id);
      await poll(started.id);
      pollRef.current = window.setInterval(() => {
        poll(started.id).catch(() => {});
      }, 800);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onProcess() {
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter a search query.');
      return;
    }
    if (selectedSongFiles.length === 0) {
      setError('Select at least one layer.');
      return;
    }
    setBusy(true);
    setJob(null);
    setJobId(null);
    stopPolling();

    try {
      const started = await api<{ id: string }>('/api/run', {
        method: 'POST',
        body: JSON.stringify({
          query: trimmed,
          download: false,
          include: selectedSongFiles.map((f) => f.name),
        }),
      });
      setJobId(started.id);
      await poll(started.id);
      pollRef.current = window.setInterval(() => {
        poll(started.id).catch(() => {});
      }, 800);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onUpload(ev: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const selected = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!baseId) {
      setError('Enter a search query first.');
      return;
    }
    if (selected.length === 0) return;

    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of selected) fd.append('files', f);
      const res = await fetch(`/api/upload/${encodeURIComponent(baseId)}`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Upload failed: ${res.status}`);
      }
      await refreshSongs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const deps = health || { ffmpeg: true, ytdlp: true, rubberband: true };
  const depsOk =
    mode === 'download'
      ? deps.ffmpeg && deps.ytdlp && deps.rubberband
      : deps.ffmpeg && deps.rubberband;

  const canSearch =
    status !== 'running' && depsOk && mode === 'download' && query.trim().length > 0;
  const canDownload =
    status !== 'running' && depsOk && mode === 'download' && selectedSearch.length > 0;
  const canProcess =
    status !== 'running' && depsOk && query.trim().length > 0 && selectedSongFiles.length > 0;

  const outputUrl = job?.result?.outputUrl || null;
  const embedId = previewUrl ? youtubeIdFromUrl(previewUrl) : null;

  async function loadRun(id: string) {
    setError(null);
    stopPolling();
    setBusy(false);
    try {
      const run = await api<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
      if (run.query) setQuery(run.query);
      if (run.kind === 'download') {
        setMode('download');
        if (run.options?.number) setNumber(Number(run.options.number) || 5);
        if (Array.isArray(run.options?.exclude))
          setExclude(run.options!.exclude!.join(','));
        if (Array.isArray(run.selected)) {
          setSearchItems(run.selected);
          const nextSel: Record<string, boolean> = {};
          for (const it of run.selected) nextSel[it.id] = true;
          setSelectedIds(nextSel);
          setPreviewUrl(run.selected[0]?.url || null);
        }
      } else {
        setMode('local');
        if (run.base_id && Array.isArray(run.include)) {
          await api(`/api/manifest/${encodeURIComponent(run.base_id)}`, {
            method: 'POST',
            body: JSON.stringify({ include: run.include }),
          });
          await refreshSongs();
        }
      }

      setJob({
        id: run.id,
        status: run.status,
        startedAt: run.created_at,
        endedAt: run.ended_at,
        logLines: run.log_text ? run.log_text.split('\n') : [],
        result:
          run.output_url && run.base_id
            ? { outputUrl: run.output_url, baseDir: `output/${run.base_id}` }
            : null,
        error: run.error,
      });
      setJobId(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium tracking-tight">song layerer</div>
          <div className="flex items-center gap-2">
            <Badge variant={status}>{status}</Badge>
            {job?.startedAt ? (
              <div className="text-xs text-neutral-400">{fmtTime(job.startedAt)}</div>
            ) : null}
            {status === 'running' ? (
              <Button
                type="button"
                onClick={onStop}
                className="h-8 border-red-900/60 bg-red-500/15 px-2.5 text-[11px] text-red-100 hover:bg-red-500/20"
              >
                stop
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-2 text-xs text-neutral-400">
          {health ? (
            <>
              ffmpeg:{health.ffmpeg ? 'ok' : 'missing'} · yt-dlp:
              {health.ytdlp ? health.ytdlpVersion || 'ok' : 'missing'} ·
              rubberband:{health.rubberband ? 'ok' : 'missing'}
              {health.ytdlpVersion &&
              /^\d{4}\.\d{2}\.\d{2}$/.test(health.ytdlpVersion) &&
              health.ytdlpVersion < '2025.01.01' ? (
                <span className="text-amber-200/80"> · update recommended</span>
              ) : null}
            </>
          ) : (
            'checking dependencies…'
          )}
        </div>

        <div className="mt-5 space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='search query (e.g. "Clair de Lune")'
            disabled={status === 'running'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => setMode('download')}
              className={
                mode === 'download'
                  ? 'bg-neutral-100 text-neutral-900 hover:bg-white'
                  : 'bg-neutral-900/40 text-neutral-100 border-neutral-800 hover:bg-neutral-900'
              }
              disabled={status === 'running'}
            >
              download
            </Button>
            <Button
              type="button"
              onClick={() => setMode('local')}
              className={
                mode === 'local'
                  ? 'bg-neutral-100 text-neutral-900 hover:bg-white'
                  : 'bg-neutral-900/40 text-neutral-100 border-neutral-800 hover:bg-neutral-900'
              }
              disabled={status === 'running'}
            >
              local mp3s
            </Button>
            <div className="ml-2 text-xs text-neutral-400">
              {mode === 'download'
                ? 'search → preview → select → download → process'
                : 'upload → select → process'}
            </div>
          </div>

          {mode === 'download' ? (
            <form onSubmit={onSearch} className="flex flex-wrap items-center gap-3">
              <Input
                className="h-9 w-[92px]"
                type="number"
                min={1}
                max={20}
                value={number}
                onChange={(e) => setNumber(Number(e.target.value))}
                disabled={status === 'running'}
                title="number of covers"
              />
              <Input
                className="h-9 flex-1 min-w-[220px]"
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                placeholder="exclude (comma-separated)"
                disabled={status === 'running'}
              />
              <Button type="submit" disabled={!canSearch} className="ml-auto">
                search
              </Button>
            </form>
          ) : null}

          {mode === 'local' ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
              <input
                ref={(el) => {
                  fileRef.current = el;
                }}
                type="file"
                accept=".mp3,audio/mpeg"
                multiple
                disabled={status === 'running' || uploading || !baseId}
                onChange={onUpload}
                className="hidden"
                aria-label="Upload mp3 files"
              />
              <Button
                type="button"
                className="bg-neutral-900/40 text-neutral-100 border-neutral-800 hover:bg-neutral-900"
                onClick={() => fileRef.current?.click()}
                disabled={status === 'running' || uploading || !baseId}
                title={!baseId ? 'Enter a search query first' : undefined}
              >
                upload mp3s
              </Button>
              {songs?.songsDir ? (
                <div className="truncate">
                  folder:{' '}
                  <span className="text-neutral-300">{songs.songsDir}</span>{' '}
                  <button
                    type="button"
                    className="ml-2 text-neutral-300 underline underline-offset-2 hover:text-neutral-100"
                    onClick={() => navigator.clipboard?.writeText(songs.songsDir)}
                  >
                    copy
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!depsOk && health ? (
            <div className="text-xs text-amber-200/80">
              missing deps for this mode. install:{' '}
              {!health.ffmpeg ? 'ffmpeg ' : ''}
              {mode === 'download' && !health.ytdlp ? 'yt-dlp ' : ''}
              {!health.rubberband ? 'rubberband ' : ''}
            </div>
          ) : null}

          {error ? <div className="text-xs text-red-300">{error}</div> : null}

          {mode === 'download' && searchItems.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-neutral-800 bg-neutral-900/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-300">
                    results ({searchItems.length}) · selected ({selectedSearch.length})
                  </div>
                  <Button
                    type="button"
                    onClick={onDownloadSelected}
                    disabled={!canDownload}
                    className="h-8 px-2.5 text-[11px]"
                  >
                    download selected
                  </Button>
                </div>

                <div className="mt-2 max-h-[320px] overflow-auto pr-1">
                  {searchItems.map((it) => {
                    const checked = Boolean(selectedIds[it.id]);
                    return (
                      <div
                        key={it.id}
                        className="flex items-center gap-2 py-1 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedIds((prev) => ({
                              ...prev,
                              [it.id]: !checked,
                            }))
                          }
                          disabled={status === 'running'}
                          className="h-4 w-4 accent-neutral-200"
                        />
                        <button
                          type="button"
                          className="truncate text-left text-neutral-100 hover:underline"
                          onClick={() => setPreviewUrl(it.url)}
                          title={it.title}
                        >
                          {it.title}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border border-neutral-800 bg-neutral-900/20 p-3">
                <div className="text-xs text-neutral-300">preview</div>
                <div className="mt-2">
                  {embedId ? (
                    <iframe
                      className="h-[240px] w-full rounded-md border border-neutral-800"
                      src={`https://www.youtube.com/embed/${embedId}`}
                      title="YouTube preview"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  ) : (
                    <div className="text-xs text-neutral-500">select a result</div>
                  )}
                </div>
                {previewUrl ? (
                  <div className="mt-2 truncate text-xs text-neutral-400">
                    {previewUrl}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {songs?.files?.length ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-900/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-300">
                  layers ({selectedSongFiles.length}/{songs.files.length})
                </div>
                <Button
                  type="button"
                  onClick={onProcess}
                  disabled={!canProcess}
                  className="h-8 px-2.5 text-[11px]"
                >
                  process selected
                </Button>
              </div>

              <div className="mt-3 grid gap-2">
                {songs.files.map((f) => (
                  <div
                    key={f.name}
                    className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-950/30 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={f.selected}
                        onChange={() => onToggleSong(f.name)}
                        disabled={status === 'running'}
                        className="h-4 w-4 accent-neutral-200"
                      />
                      <div className="truncate text-xs text-neutral-100" title={f.name}>
                        {f.name}
                      </div>
                    </div>
                    <audio controls preload="none" src={f.url} className="w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : baseId ? (
            <div className="text-xs text-neutral-500">
              {mode === 'download'
                ? 'search then download, or switch to local mp3s'
                : 'upload mp3s to begin'}
            </div>
          ) : null}

          {outputUrl ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-900/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-300">final</div>
                <a
                  className="text-xs text-neutral-200 underline underline-offset-2"
                  href={outputUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  download wav
                </a>
              </div>
              <audio controls preload="none" src={outputUrl} className="mt-2 w-full" />
            </div>
          ) : null}

          <div className="rounded-md border border-neutral-800 bg-neutral-900/20 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-300">history</div>
              <Button
                type="button"
                className="h-8 px-2.5 text-[11px] bg-neutral-900/40 text-neutral-100 border-neutral-800 hover:bg-neutral-900"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen ? 'hide' : 'show'}
              </Button>
            </div>
            {historyOpen ? (
              <div className="mt-2 max-h-[220px] overflow-auto pr-1">
                {runs.length ? (
                  runs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => loadRun(r.id)}
                      className="w-full rounded-md border border-transparent px-2 py-1 text-left text-xs hover:border-neutral-800 hover:bg-neutral-950/40"
                      title={r.id}
                    >
                      <span className="text-neutral-200">
                        {r.query || r.base_id || r.id}
                      </span>
                      <span className="text-neutral-500">
                        {' '}
                        · {r.kind} · {r.status} ·{' '}
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      {r.output_url ? (
                        <span className="text-neutral-500"> · has output</span>
                      ) : null}
                      {r.error ? (
                        <span className="text-red-300"> · {r.error}</span>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="text-xs text-neutral-500">no runs yet</div>
                )}
              </div>
            ) : null}
          </div>

          <Textarea
            className="h-[260px] resize-none font-mono text-xs"
            value={logText || (jobId ? '…' : 'ready')}
            readOnly
            aria-label="logs"
            ref={(el) => {
              logRef.current = el;
            }}
          />
        </div>
      </div>
    </div>
  );
}
