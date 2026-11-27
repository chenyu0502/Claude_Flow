/**
 * WebCodecs 的聲音編碼 API。TypeScript 5.6 的 DOM 型別只有視訊部分（VideoEncoder），
 * 這裡補上 exporter.ts 用到的最小宣告。升級 TypeScript 後如果出現重複宣告的錯誤，刪掉這個檔案即可。
 */
interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

interface AudioEncoderSupport {
  supported?: boolean;
  config?: AudioEncoderConfig;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: { codec: string; sampleRate: number; numberOfChannels: number; description?: BufferSource };
}

interface AudioEncoderInit {
  output: (chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata) => void;
  error: (error: DOMException) => void;
}

declare class AudioData {
  constructor(init: {
    format: 'f32-planar' | 'f32' | 's16' | 's16-planar';
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: BufferSource;
  });
  close(): void;
}

declare class AudioEncoder {
  constructor(init: AudioEncoderInit);
  static isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
}
