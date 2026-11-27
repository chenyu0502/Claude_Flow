import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImageDown, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { GROUPS, STYLES, findStyle, pieceUrl, thumbUrl, type StyleGroup } from '../studio/catalog';
import { DEFAULT_TEXT, LIMITS, fileName, pieceSrc, validateText, type StudioText } from '../studio/params';
import { canExportMp4, downloadBlob, exportMp4, type PieceWindow } from '../studio/exporter';
import './studio.css';

const FPS = 24;
const NFRAMES = 240;
const STYLE_KEY = 'cf-studio-style';

function readStoredStyle(): string | null {
  try {
    return localStorage.getItem(STYLE_KEY);
  } catch {
    return null;
  }
}

const fmt = (frame: number) => `${(frame / FPS).toFixed(1)} 秒`;

type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; pct: number; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export default function StudioPage() {
  const [styleId, setStyleId] = useState(() => findStyle(readStoredStyle()).id);
  const style = findStyle(styleId);
  const [group, setGroup] = useState<StyleGroup | 'all'>('all');
  const [text, setText] = useState<StudioText>(DEFAULT_TEXT);
  /** 實際套用到動畫的文字（輸入後停 0.5 秒才重新載入動畫） */
  const [appliedText, setAppliedText] = useState<StudioText>(DEFAULT_TEXT);
  const [playing, setPlaying] = useState(true);
  const [sound, setSound] = useState(false);
  const [frame, setFrame] = useState(0);
  /** 已載入完成的 iframe 網址；和目前的 src 相同才算就緒（換網址時自動變回未就緒，不會和 onLoad 搶先後） */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'1080' | '720'>('1080');
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const winRef = useRef<PieceWindow | null>(null);
  const frameRef = useRef(0);
  const clock = useRef({ start: 0, offset: 0 });
  const audio = useRef<{ ac: AudioContext | null; src: AudioBufferSourceNode | null; buffers: Map<string, AudioBuffer> }>({
    ac: null,
    src: null,
    buffers: new Map(),
  });
  const exportingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const errors = useMemo(() => validateText(text, style), [text, style]);
  const src = useMemo(() => pieceSrc(pieceUrl(style.id), appliedText, style), [style, appliedText]);
  const exporting = exportState.kind === 'running';
  const ready = loadedSrc === src;
  const supportsMp4 = useMemo(() => canExportMp4(), []);

  // 輸入停下 0.5 秒、且內容合法才套用到動畫
  useEffect(() => {
    if (errors.length) return;
    const id = window.setTimeout(() => setAppliedText(text), 500);
    return () => window.clearTimeout(id);
  }, [text, errors.length]);

  useEffect(() => {
    try {
      localStorage.setItem(STYLE_KEY, styleId);
    } catch {
      /* 記不住也沒關係 */
    }
  }, [styleId]);

  const draw = useCallback((f: number) => {
    const win = winRef.current;
    if (!win || exportingRef.current) return;
    try {
      win.renderFrame(f / FPS);
    } catch (e) {
      console.error('[studio] 畫面繪製失敗', e);
    }
  }, []);

  // ---- 聲音 ----
  const stopAudio = useCallback(() => {
    const a = audio.current;
    try {
      a.src?.stop();
    } catch {
      /* 已經停了 */
    }
    a.src = null;
  }, []);

  const startAudio = useCallback(
    async (fromFrame: number) => {
      const win = winRef.current;
      if (!win?.buildScore) return;
      const a = audio.current;
      a.ac ??= new AudioContext();
      if (a.ac.state === 'suspended') await a.ac.resume();
      let buf = a.buffers.get(style.id);
      if (!buf) {
        const score = await win.buildScore(a.ac.sampleRate);
        buf = a.ac.createBuffer(2, score.left.length, score.sampleRate);
        buf.copyToChannel(new Float32Array(score.left), 0);
        buf.copyToChannel(new Float32Array(score.right), 1);
        a.buffers.set(style.id, buf);
      }
      stopAudio();
      const node = a.ac.createBufferSource();
      node.buffer = buf;
      node.loop = true;
      node.connect(a.ac.destination);
      node.start(0, fromFrame / FPS);
      a.src = node;
    },
    [style.id, stopAudio],
  );

  // ---- 播放迴圈：以 performance.now() 計時，聲音從同一個位置開始，兩者同步 ----
  useEffect(() => {
    if (!ready) return;
    if (!playing) {
      draw(frameRef.current);
      return;
    }
    clock.current = { start: performance.now(), offset: frameRef.current };
    let raf = 0;
    let last = -1;
    const tick = () => {
      const f = Math.floor(clock.current.offset + ((performance.now() - clock.current.start) / 1000) * FPS) % NFRAMES;
      if (f !== last) {
        last = f;
        frameRef.current = f;
        draw(f);
        setFrame(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, draw]);

  useEffect(() => {
    if (playing && sound && ready && !exporting) {
      startAudio(frameRef.current).catch((e) => console.error('[studio] 播放聲音失敗', e));
      // 播放迴圈也從這一格重新計時
      clock.current = { start: performance.now(), offset: frameRef.current };
    } else stopAudio();
    return stopAudio;
  }, [playing, sound, ready, exporting, startAudio, stopAudio]);

  useEffect(
    () => () => {
      stopAudio();
      audio.current.ac?.close().catch(() => undefined);
      abortRef.current?.abort();
    },
    [stopAudio],
  );

  const onLoad = (loaded: string) => {
    const win = iframeRef.current?.contentWindow as PieceWindow | null;
    if (!win || typeof win.renderFrame !== 'function') return;
    winRef.current = win;
    setLoadedSrc(loaded);
    draw(frameRef.current);
  };

  const chooseStyle = (id: string) => {
    if (id === styleId || exporting) return;
    winRef.current = null;
    setStyleId(id);
    setExportState({ kind: 'idle' });
  };

  const scrub = (f: number) => {
    setPlaying(false);
    frameRef.current = f;
    setFrame(f);
    draw(f);
  };

  const setName = (i: number, v: string) =>
    setText((t) => {
      const names = [...t.names] as StudioText['names'];
      names[i] = v;
      return { ...t, names };
    });

  const resetText = () => {
    setText(DEFAULT_TEXT);
    setAppliedText(DEFAULT_TEXT);
  };

  const pngDownload = () => {
    const doc = iframeRef.current?.contentDocument;
    const canvas = doc?.getElementById('c') as HTMLCanvasElement | null;
    if (!canvas) return;
    draw(frameRef.current);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, fileName(style, 'png', `_${(frameRef.current / FPS).toFixed(1)}秒`));
    }, 'image/png');
  };

  const mp4Download = async () => {
    const win = winRef.current;
    const canvas = iframeRef.current?.contentDocument?.getElementById('c') as HTMLCanvasElement | null;
    if (!win || !canvas) return;
    const wasPlaying = playing;
    setPlaying(false);
    stopAudio();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    exportingRef.current = true;
    setExportState({ kind: 'running', pct: 0, label: '準備中…' });
    const started = performance.now();
    try {
      const [w, h] = resolution === '1080' ? [1920, 1080] : [1280, 720];
      const res = await exportMp4(win, canvas, {
        width: w,
        height: h,
        withAudio: true,
        signal: ctrl.signal,
        onProgress: (done, total, phase) =>
          setExportState({
            kind: 'running',
            pct: phase === 'audio' ? 2 : Math.round(5 + (done / total) * 93),
            label: phase === 'audio' ? '合成配樂…' : phase === 'finish' ? '封裝影片…' : `繪製畫面 ${done} / ${total}`,
          }),
      });
      downloadBlob(res.blob, fileName(style, 'mp4'));
      const secs = ((performance.now() - started) / 1000).toFixed(0);
      const mb = (res.blob.size / 1024 / 1024).toFixed(1);
      const note = res.audio === 'none' ? '（這個瀏覽器無法編碼聲音，影片沒有配樂）' : '';
      setExportState({ kind: 'done', message: `已下載 ${fileName(style, 'mp4')}，${mb} MB，花了 ${secs} 秒${note}` });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setExportState({ kind: 'idle' });
      else {
        console.error('[studio] 匯出失敗', e);
        setExportState({ kind: 'error', message: e instanceof Error ? e.message : '匯出失敗' });
      }
    } finally {
      exportingRef.current = false;
      abortRef.current = null;
      draw(frameRef.current);
      if (wasPlaying) setPlaying(true);
    }
  };

  const visible = group === 'all' ? STYLES : STYLES.filter((s) => s.group === group);

  return (
    <div className="container studio">
      <header className="page-head">
        <span className="eyebrow">圖片／影片／動畫製作</span>
        <h1>動畫工作室</h1>
        <p>選一種畫風，改成你們自己的名字和字幕，直接在瀏覽器裡做出 10 秒的三兄妹打雪仗動畫。</p>
      </header>

      <div className="studio-layout">
        <section className="studio-stage" aria-label="預覽">
          <div className="studio-screen">
            <iframe
              key={src}
              ref={iframeRef}
              src={src}
              title={`${style.name}預覽`}
              onLoad={() => onLoad(src)}
              tabIndex={-1}
            />
            {!ready && <div className="studio-loading">載入中…</div>}
          </div>

          <div className="studio-transport">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setPlaying((p) => !p)}
              disabled={!ready || exporting}
              aria-label={playing ? '暫停' : '播放'}
              title={playing ? '暫停' : '播放'}
            >
              {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            </button>
            <input
              type="range"
              min={0}
              max={NFRAMES - 1}
              value={frame}
              onChange={(e) => scrub(Number(e.target.value))}
              disabled={!ready || exporting}
              aria-label="時間"
            />
            <span className="studio-time">{fmt(frame)}</span>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setSound((s) => !s)}
              disabled={exporting}
              aria-pressed={sound}
              aria-label={sound ? '關閉聲音' : '開啟聲音'}
              title={sound ? '關閉聲音' : '開啟聲音'}
            >
              {sound ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
            </button>
          </div>

          <div className="card studio-export">
            <div className="studio-export-row">
              <div className="field">
                <label htmlFor="studio-res">影片解析度</label>
                <select
                  id="studio-res"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as '1080' | '720')}
                  disabled={exporting}
                >
                  <option value="1080">1920 × 1080（Full HD）</option>
                  <option value="720">1280 × 720（檔案較小）</option>
                </select>
              </div>
              <div className="studio-export-actions">
                <button type="button" className="btn" onClick={pngDownload} disabled={!ready || exporting}>
                  <ImageDown size={18} aria-hidden="true" /> 下載這一格 PNG
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={mp4Download}
                  disabled={!ready || exporting || !supportsMp4 || errors.length > 0}
                >
                  <Download size={18} aria-hidden="true" /> 下載 MP4
                </button>
              </div>
            </div>

            {exportState.kind === 'running' && (
              <div className="studio-progress" role="status">
                <div className="studio-bar">
                  <span style={{ width: `${exportState.pct}%` }} />
                </div>
                <span className="muted">{exportState.label}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>
                  <X size={16} aria-hidden="true" /> 取消
                </button>
              </div>
            )}
            {exportState.kind === 'done' && <p className="alert alert-success">{exportState.message}</p>}
            {exportState.kind === 'error' && <p className="alert alert-error">{exportState.message}</p>}
            {!supportsMp4 && (
              <p className="alert alert-error">這個瀏覽器不支援在本機產生影片，請改用最新版 Chrome、Edge 或 Safari。</p>
            )}
            <p className="studio-note muted">
              影片在你的瀏覽器裡產生，不會上傳到伺服器，也不需要點數。一般電腦大約半分鐘，製作中請不要切換分頁。
            </p>
          </div>
        </section>

        <aside className="studio-panel">
          <section className="card">
            <div className="studio-panel-head">
              <h2>畫風</h2>
              <span className="badge">{STYLES.length} 種</span>
            </div>
            <div className="studio-chips" role="tablist" aria-label="畫風分類">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={group === g.id}
                  className={group === g.id ? 'studio-chip active' : 'studio-chip'}
                  onClick={() => setGroup(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="studio-styles">
              {visible.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === style.id ? 'studio-style active' : 'studio-style'}
                  onClick={() => chooseStyle(s.id)}
                  disabled={exporting}
                  aria-pressed={s.id === style.id}
                  title={s.blurb}
                >
                  <img src={thumbUrl(s.id)} alt="" loading="lazy" width={480} height={270} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
            <p className="studio-blurb muted">
              <strong>{style.name}</strong>：{style.blurb}
            </p>
          </section>

          <section className="card">
            <div className="studio-panel-head">
              <h2>名字與字幕</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetText} disabled={exporting}>
                <RotateCcw size={14} aria-hidden="true" /> 還原
              </button>
            </div>
            <div className="stack studio-fields">
              {style.fields.includes('names') ? (
                <div className="studio-names">
                  {DEFAULT_TEXT.names.map((d, i) => (
                    <div className="field" key={d}>
                      <label htmlFor={`studio-name-${i}`}>{d}</label>
                      <input
                        id={`studio-name-${i}`}
                        value={text.names[i]}
                        maxLength={LIMITS.name * 2}
                        placeholder={d}
                        onChange={(e) => setName(i, e.target.value)}
                        disabled={exporting}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted studio-hint">這個畫風畫面上沒有名字。想放名字可以選海洋冒險、RPG 戰鬥、數學動畫或像素風。</p>
              )}
              {style.fields.includes('end') && (
                <div className="field">
                  <label htmlFor="studio-end">結尾字幕（最多 {LIMITS.end} 字）</label>
                  <input
                    id="studio-end"
                    value={text.end}
                    placeholder={DEFAULT_TEXT.end}
                    onChange={(e) => setText((t) => ({ ...t, end: e.target.value }))}
                    disabled={exporting}
                  />
                </div>
              )}
              {style.fields.includes('hit') && (
                <div className="field">
                  <label htmlFor="studio-hit">大雪球砸下時的字（最多 {LIMITS.hit} 字）</label>
                  <input
                    id="studio-hit"
                    value={text.hit}
                    placeholder={DEFAULT_TEXT.hit}
                    onChange={(e) => setText((t) => ({ ...t, hit: e.target.value }))}
                    disabled={exporting}
                  />
                </div>
              )}
              {errors.length > 0 && (
                <div className="alert alert-error" role="alert">
                  {errors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
