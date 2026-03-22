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
  runId?: string | null;
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
  return query.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 120);
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

function formatAudioTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <path d="M8 6v12l10-6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <path d="M7 6h4v12H7zM13 6h4v12h-4z" />
    </svg>
  );
}

function InlinePlayer({
  src,
  className = '',
  ariaLabel = 'Audio player',
}: {
  src: string;
  className?: string;
  ariaLabel?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnd = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnd);

    onLoaded();
    onTime();
    onPause();

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnd);
    };
  }, [src]);

  async function onTogglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        // ignore autoplay/permission failures
      }
      return;
    }
    audio.pause();
  }

  function onSeek(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.min(Math.max(next, 0), duration || 0);
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={ariaLabel}
        className="flex h-7 w-7 shrink-0 items-center justify-center border border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.1}
        value={Math.min(currentTime, Math.max(duration, 0.01))}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="slim-range h-1 min-w-0 flex-1"
      />
      <div className="w-[72px] shrink-0 text-right text-[10px] text-neutral-400">
        {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
      </div>
    </div>
  );
}

function runIdFromOutputUrl(outputUrl: string) {
  const m = outputUrl.match(/\/runs\/([^/]+)\/layered\.wav(?:\?|#|$)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('download');
  const [query, setQuery] = useState('');
  const [number, setNumber] = useState(5);
  const [exclude, setExclude] = useState('');

  const [health, setHealth] = useState<Health | null>(null);
  const [songs, setSongs] = useState<SongsResponse | null>(null);
  const [songsRunId, setSongsRunId] = useState<string | null>(null);

  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunSummary[]>([]);

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
        const rid = next.result?.outputUrl ? runIdFromOutputUrl(next.result.outputUrl) : null;
        if (rid) setSongsRunId(rid);
        else api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}`).then(setSongs).catch(() => {});
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
    const qs = songsRunId ? `?runId=${encodeURIComponent(songsRunId)}` : '';
    api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}${qs}`)
      .then(setSongs)
      .catch(() => setSongs(null));
  }, [baseId, songsRunId]);

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
    const qs = songsRunId ? `?runId=${encodeURIComponent(songsRunId)}` : '';
    const next = await api<SongsResponse>(`/api/songs/${encodeURIComponent(baseId)}${qs}`);
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
    if (!songsRunId) {
      try {
        await persistInclude(nextFiles);
      } catch {
        // ignore
      }
    }
  }

  function setAllSearchSelection(selected: boolean) {
    const next: Record<string, boolean> = {};
    for (const it of searchItems) next[it.id] = selected;
    setSelectedIds(next);
  }

  async function setAllSongSelection(selected: boolean) {
    if (!songs) return;
    const nextFiles = songs.files.map((f) => ({ ...f, selected }));
    setSongs({ ...songs, files: nextFiles });
    if (!songsRunId) {
      try {
        await persistInclude(nextFiles);
      } catch {
        // ignore persistence failure here; UI state is still useful
      }
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSongsRunId(null);
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
    setSongsRunId(null);
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
          sourceRunId: songsRunId,
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
      setSongsRunId(null);
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
  const hasSearchItems = searchItems.length > 0;
  const hasLayers = Boolean(songs?.files?.length);
  const showResultsStep = mode === 'download' && hasSearchItems;
  const showLayersStep = hasLayers;
  const layersStepNumber = showResultsStep ? 4 : 3;
  const finalStepNumber = 2 + (showResultsStep ? 1 : 0) + (showLayersStep ? 1 : 0);

  async function loadRun(id: string) {
    setError(null);
    stopPolling();
    setBusy(false);
    try {
      const run = await api<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
      if (run.query) setQuery(run.query);
      if (run.kind === 'download') {
        setMode('download');
        setSongsRunId(null);
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
        if (run.base_id) {
          setSongsRunId(run.id);
          api<SongsResponse>(
            `/api/songs/${encodeURIComponent(run.base_id)}?runId=${encodeURIComponent(run.id)}`
          )
            .then(setSongs)
            .catch(() => {});
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
    <div className="h-dvh overflow-hidden bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800/60">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-medium tracking-tight">song layerer</div>
            <div className="mt-1 text-[11px] text-neutral-400">
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
          </div>
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
      </header>

      <div className="flex w-full flex-1 min-h-0 overflow-hidden px-0 py-0">
        <div className="grid h-full min-h-0 w-full gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className="min-h-0">
            <div className="flex h-full flex-col rounded-none border border-neutral-800 bg-neutral-900/20">
              <div className="flex items-center justify-between border-b border-neutral-800/60 px-3 py-2">
                <div className="text-xs text-neutral-300">history</div>
                <div className="text-[10px] text-neutral-500">{runs.length}</div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-2">
                {runs.length ? (
                  runs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => loadRun(r.id)}
                      className="w-full rounded-none border border-transparent px-2 py-1 text-left text-xs hover:border-neutral-800 hover:bg-neutral-950/40"
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
            </div>
          </aside>

          <main className="main-column min-h-0 flex flex-col gap-4 overflow-hidden">
            <div className="main-scroll-area flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              <section className="main-panel">
                <div className="main-panel-head">
                  <div>
                    <div className="panel-title">1. source mode</div>
                  </div>
                </div>

                <div className="mt-1">
                  <div role="tablist" aria-label="mode" className="grid grid-cols-2 gap-2">
                    <button
                      role="tab"
                      type="button"
                      aria-selected={mode === 'download'}
                      onClick={() => {
                        setSongsRunId(null);
                        setMode('download');
                      }}
                      disabled={status === 'running'}
                      className={mode === 'download' ? 'mode-option is-active' : 'mode-option'}
                    >
                      <span className="mode-option-title">download</span>
                      <span className="mode-option-copy">search and fetch from YouTube</span>
                    </button>
                    <button
                      role="tab"
                      type="button"
                      aria-selected={mode === 'local'}
                      onClick={() => setMode('local')}
                      disabled={status === 'running'}
                      className={mode === 'local' ? 'mode-option is-active' : 'mode-option'}
                    >
                      <span className="mode-option-title">local mp3s</span>
                      <span className="mode-option-copy">upload files from your machine</span>
                    </button>
                  </div>
                </div>
              </section>

              {mode === 'download' ? (
                <section className="main-panel">
                  <div className="main-panel-head">
                    <div>
                      <div className="panel-title">2. search candidates</div>
                    </div>
                  </div>
                  <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)_auto]">
                    <div className="grid gap-2 sm:col-span-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        className="h-8 rounded-none text-xs"
                        value={query}
                        onChange={(e) => {
                          setSongsRunId(null);
                          setQuery(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder='search query (e.g. "Clair de Lune")'
                        disabled={status === 'running'}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        autoFocus
                      />
                      <Button
                        type="submit"
                        disabled={!canSearch}
                        className="h-8 rounded-none px-3 text-xs"
                      >
                        search
                      </Button>
                    </div>
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                        count
                      </span>
                      <Input
                        className="h-8 rounded-none text-xs"
                        type="number"
                        min={1}
                        max={20}
                        value={number}
                        onChange={(e) => setNumber(Number(e.target.value))}
                        disabled={status === 'running'}
                        title="number of covers"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                        exclude keywords
                      </span>
                      <Input
                        className="h-8 rounded-none text-xs"
                        value={exclude}
                        onChange={(e) => setExclude(e.target.value)}
                        placeholder="live, remix, instrumental..."
                        disabled={status === 'running'}
                      />
                    </label>
                  </form>
                </section>
              ) : (
                <section className="main-panel">
                  <div className="main-panel-head">
                    <div>
                      <div className="panel-title">2. upload local mp3s</div>
                    </div>
                  </div>
                  <Input
                    className="mb-3 h-8 rounded-none text-xs"
                    value={query}
                    onChange={(e) => {
                      setSongsRunId(null);
                      setQuery(e.target.value);
                    }}
                    placeholder="stack name (used for folder grouping)"
                    disabled={status === 'running'}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                  />
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
                  <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                    <Button
                      type="button"
                      className="h-8 rounded-none border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-100 hover:bg-neutral-900"
                      onClick={() => fileRef.current?.click()}
                      disabled={status === 'running' || uploading || !baseId}
                      title={!baseId ? 'Enter a search query first' : undefined}
                    >
                      {uploading ? 'uploading…' : 'upload mp3s'}
                    </Button>
                    {songs?.songsDir ? (
                      <div className="min-w-0 flex-1 truncate">
                        folder: <span className="text-neutral-200">{songs.songsDir}</span>
                        <button
                          type="button"
                          className="ml-2 text-neutral-300 underline underline-offset-2 hover:text-neutral-100"
                          onClick={() => navigator.clipboard?.writeText(songs.songsDir)}
                        >
                          copy
                        </button>
                      </div>
                    ) : (
                      <div>Use a query first so uploaded files are grouped consistently.</div>
                    )}
                  </div>
                </section>
              )}

              {!depsOk && health ? (
                <div className="main-callout">
                  Missing dependencies for this mode. Install:
                  {!health.ffmpeg ? ' ffmpeg' : ''}
                  {mode === 'download' && !health.ytdlp ? ' yt-dlp' : ''}
                  {!health.rubberband ? ' rubberband' : ''}
                </div>
              ) : null}

              {error ? (
                <div className="main-callout">
                  {error}
                </div>
              ) : null}

              {showResultsStep ? (
                <section className="main-panel">
                  <div className="main-panel-head">
                    <div>
                      <div className="panel-title">3. pick results</div>
                      <div className="mt-1 text-xs text-neutral-400">
                        {searchItems.length} results, {selectedSearch.length} selected
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        className="h-7 rounded-none border-neutral-700 bg-neutral-900 text-[11px] text-neutral-100 hover:bg-neutral-900"
                        onClick={() => setAllSearchSelection(true)}
                        disabled={status === 'running'}
                      >
                        select all
                      </Button>
                      <Button
                        type="button"
                        className="h-7 rounded-none border-neutral-700 bg-neutral-900 text-[11px] text-neutral-100 hover:bg-neutral-900"
                        onClick={() => setAllSearchSelection(false)}
                        disabled={status === 'running'}
                      >
                        clear
                      </Button>
                      <Button
                        type="button"
                        onClick={onDownloadSelected}
                        disabled={!canDownload}
                        className="h-7 rounded-none px-3 text-[11px]"
                      >
                        download selected
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,42%)]">
                    <div className="max-h-[340px] overflow-auto pr-1">
                      <div className="space-y-1.5">
                        {searchItems.map((it) => {
                          const checked = Boolean(selectedIds[it.id]);
                          const previewing = previewUrl === it.url;
                          return (
                            <div
                              key={it.id}
                              className={
                                checked
                                  ? 'search-row is-selected'
                                  : previewing
                                    ? 'search-row is-preview'
                                    : 'search-row'
                              }
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
                                className="h-4 w-4 shrink-0 accent-neutral-200"
                              />
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left text-sm text-neutral-100"
                                onClick={() => setPreviewUrl(it.url)}
                                title={it.title}
                              >
                                {it.title}
                              </button>
                              {previewing ? (
                                <span className="shrink-0 self-center text-[10px] uppercase tracking-wide text-neutral-400">
                                  preview
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="search-preview-pane">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                        preview
                      </div>
                      {embedId ? (
                        <iframe
                          className="h-[252px] w-full border border-neutral-700/70"
                          src={`https://www.youtube.com/embed/${embedId}`}
                          title="YouTube preview"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      ) : (
                        <div className="border border-neutral-800 bg-neutral-950/60 p-5 text-xs text-neutral-500">
                          Pick a result to load preview.
                        </div>
                      )}
                      {previewUrl ? (
                        <div className="mt-2 truncate text-xs text-neutral-400">{previewUrl}</div>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}

              {showLayersStep ? (
                <section className="main-panel">
                  <div className="main-panel-head">
                    <div>
                      <div className="panel-title">{layersStepNumber}. pick layers</div>
                      <div className="mt-1 text-xs text-neutral-400">
                        {selectedSongFiles.length}/{songs!.files.length} selected
                        {songsRunId ? <span className="text-neutral-500"> · from run history</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        className="h-7 rounded-none border-neutral-700 bg-neutral-900 text-[11px] text-neutral-100 hover:bg-neutral-900"
                        onClick={() => void setAllSongSelection(true)}
                        disabled={status === 'running'}
                      >
                        select all
                      </Button>
                      <Button
                        type="button"
                        className="h-7 rounded-none border-neutral-700 bg-neutral-900 text-[11px] text-neutral-100 hover:bg-neutral-900"
                        onClick={() => void setAllSongSelection(false)}
                        disabled={status === 'running'}
                      >
                        clear
                      </Button>
                      {songsRunId ? (
                        <Button
                          type="button"
                          className="h-7 rounded-none border-neutral-700 bg-neutral-900 px-2.5 text-[11px] text-neutral-100 hover:bg-neutral-900"
                          onClick={() => setSongsRunId(null)}
                          disabled={status === 'running'}
                          title="Back to current layer folder"
                        >
                          latest layers
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        onClick={onProcess}
                        disabled={!canProcess}
                        className="h-7 rounded-none px-3 text-[11px]"
                      >
                        process selected
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-[360px] overflow-y-auto pr-1">
                    <div className="grid gap-2">
                      {songs!.files.map((f) => (
                        <div
                          key={f.name}
                          className={f.selected ? 'layer-row is-selected' : 'layer-row'}
                        >
                          <input
                            type="checkbox"
                            checked={f.selected}
                            onChange={() => onToggleSong(f.name)}
                            disabled={status === 'running'}
                            className="h-4 w-4 shrink-0 accent-neutral-200"
                          />
                          <div className="min-w-0 flex-1 truncate text-xs text-neutral-100" title={f.name}>
                            {f.name}
                          </div>
                          <InlinePlayer
                            src={f.url}
                            className="w-full min-w-[210px] max-w-[340px] shrink-0"
                            ariaLabel={`Play ${f.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>

            <div className={outputUrl ? 'main-output-dock is-ready' : 'main-output-dock'}>
              {outputUrl ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-neutral-100">
                      {finalStepNumber}. final wav ready
                    </div>
                  </div>
                  <InlinePlayer
                    src={outputUrl}
                    className="min-w-[240px] flex-1"
                    ariaLabel="Play final track"
                  />
                  <a
                    className="shrink-0 border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-100 hover:bg-neutral-900"
                    href={outputUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    download wav
                  </a>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-neutral-300">
                      {finalStepNumber}. process selected layers for final wav.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="min-h-0">
            <div className="flex h-full flex-col rounded-none border border-neutral-800 bg-neutral-900/20">
              <div className="border-b border-neutral-800/60 px-3 py-2 text-xs text-neutral-300">
                terminal
              </div>
              <Textarea
                className="flex-1 min-h-0 resize-none border-0 bg-transparent font-mono text-xs"
                value={logText || (jobId ? '…' : 'ready')}
                readOnly
                aria-label="logs"
                ref={(el) => {
                  logRef.current = el;
                }}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
