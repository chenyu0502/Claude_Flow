/**
 * 在瀏覽器裡把動畫匯出成 MP4（H.264 + AAC），不經過伺服器。
 *
 * 畫面：動畫 iframe 的 window.renderFrame(i / 24) 逐格畫到它的 canvas，WebCodecs VideoEncoder 編碼。
 *       不是即時錄影，每一格都和 Claude_Animate 匯出的一樣，速度取決於電腦。
 * 聲音：window.buildScore(48000) 用 OfflineAudioContext 算出整段配樂，AudioEncoder 編成 AAC
 *       （瀏覽器不支援 AAC 時改用 Opus；兩者都不支援時只輸出畫面）。
 * 封裝：mp4-muxer，moov 放在檔頭（fastStart），手機與 LINE 可直接播放。
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface PieceWindow extends Window {
  renderFrame: (t: number, canvas?: HTMLCanvasElement) => string;
  buildScore?: (sampleRate: number) => Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }>;
  FPS?: number;
  NFRAMES?: number;
}

export interface ExportOptions {
  width: number;
  height: number;
  withAudio: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, phase: 'video' | 'audio' | 'finish') => void;
}

export interface ExportResult {
  blob: Blob;
  audio: 'aac' | 'opus' | 'none';
}

/** 這個瀏覽器能不能在本機匯出 MP4 */
export function canExportMp4(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function pickVideoConfig(width: number, height: number): Promise<VideoEncoderConfig> {
  // High → Main → Baseline；level 4.0 足夠 1080p24，720p 用 3.1
  const level = width * height > 1280 * 720 ? '28' : '1f';
  for (const profile of ['6400', '4d00', '4200']) {
    const config: VideoEncoderConfig = {
      codec: `avc1.${profile}${level}`,
      width,
      height,
      bitrate: width >= 1920 ? 8_000_000 : 4_500_000,
      framerate: 24,
      avc: { format: 'avc' },
    };
    const res = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (res?.supported) return config;
  }
  throw new Error('這個瀏覽器不支援 H.264 編碼，請改用最新版 Chrome 或 Edge');
}

async function pickAudioConfig(): Promise<{ config: AudioEncoderConfig; codec: 'aac' | 'opus' } | null> {
  if (!('AudioEncoder' in window)) return null;
  const base = { sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 };
  for (const [codec, name] of [
    ['mp4a.40.2', 'aac'],
    ['opus', 'opus'],
  ] as const) {
    const config = { ...base, codec };
    const res = await AudioEncoder.isConfigSupported(config).catch(() => null);
    if (res?.supported) return { config, codec: name };
  }
  return null;
}

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('已取消匯出', 'AbortError');
};

export async function exportMp4(win: PieceWindow, source: HTMLCanvasElement, opts: ExportOptions): Promise<ExportResult> {
  const { width, height, withAudio, signal, onProgress } = opts;
  const fps = win.FPS ?? 24;
  const total = win.NFRAMES ?? Math.round(10 * fps);

  const videoConfig = await pickVideoConfig(width, height);
  const audio = withAudio && win.buildScore ? await pickAudioConfig() : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audio ? { audio: { codec: audio.codec, sampleRate: 48000, numberOfChannels: 2 } } : {}),
  });

  let failure: Error | null = null;
  const fail = (e: unknown) => {
    failure = e instanceof Error ? e : new Error(String(e));
  };

  // ---- 聲音：先算好整段配樂（約 1 秒），和畫面分開編碼 ----
  if (audio && win.buildScore) {
    onProgress?.(0, total, 'audio');
    const score = await win.buildScore(48000);
    aborted(signal);
    const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    enc.configure(audio.config);
    const n = score.left.length;
    const block = 48000; // 一次送 1 秒
    for (let i = 0; i < n; i += block) {
      const len = Math.min(block, n - i);
      const planar = new Float32Array(len * 2);
      planar.set(score.left.subarray(i, i + len), 0);
      planar.set(score.right.subarray(i, i + len), len);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: len,
        numberOfChannels: 2,
        timestamp: Math.round((i / 48000) * 1e6),
        data: planar,
      });
      enc.encode(data);
      data.close();
    }
    await enc.flush();
    enc.close();
  }
  if (failure) throw failure;

  // ---- 畫面：逐格 renderFrame → VideoFrame → 編碼 ----
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  enc.configure(videoConfig);
  const scaled = width !== source.width || height !== source.height;
  const stage = scaled ? new OffscreenCanvas(width, height) : null;
  const g = stage?.getContext('2d');
  if (g) g.imageSmoothingQuality = 'high';
  const frameDur = 1e6 / fps;

  for (let i = 0; i < total; i++) {
    aborted(signal);
    if (failure) throw failure;
    win.renderFrame(i / fps);
    if (g && stage) g.drawImage(source, 0, 0, width, height);
    const frame = new VideoFrame(stage ?? source, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // 編碼器排隊太多時等一下，避免記憶體暴增；同時讓畫面有機會更新進度
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
    if (i % 6 === 0) {
      onProgress?.(i, total, 'video');
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(total, total, 'finish');
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), audio: audio?.codec ?? 'none' };
}

/** 觸發瀏覽器下載 */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
