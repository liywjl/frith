/**
 * Live transcription add-on: Whisper running IN THE BROWSER via
 * @huggingface/transformers — audio never leaves this device, which is the
 * only posture that fits a space whose content is sealed end-to-end. The
 * library and model load lazily on first use (the model is a one-time
 * ~40 MB download from the Hugging Face hub, cached by the browser), so the
 * main bundle pays nothing for this.
 */
export type TranscriberState = 'loading' | 'live' | 'error';

const SAMPLE_RATE = 16_000;
/** Transcribe in windows: long enough for Whisper to have context, short
 *  enough to feel live. */
const WINDOW_MS = 7_000;

type AsrPipeline = (audio: Float32Array) => Promise<{ text?: string } | { text?: string }[]>;

export class LiveTranscriber {
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mix: GainNode | null = null;
  private buffer: Float32Array[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private asr: AsrPipeline | null = null;
  private busy = false;
  private stopped = false;
  private sources = new Set<MediaStream>();

  constructor(
    private onText: (text: string) => void,
    private onState: (state: TranscriberState) => void,
  ) {}

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(streams: (MediaStream | null)[]): Promise<boolean> {
    if (this.running) return true;
    this.onState('loading');
    try {
      const { pipeline } = await import('@huggingface/transformers');
      this.asr = (await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en')) as AsrPipeline;
    } catch {
      this.onState('error');
      return false;
    }
    if (this.stopped) return false; // stopped while the model was downloading
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.mix = this.ctx.createGain();
    for (const stream of streams) if (stream) this.addAudio(stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.mix.connect(this.processor);
    // A processor only runs when routed to the destination — mute the route
    // so transcription never echoes the call back out of the speakers.
    const muted = this.ctx.createGain();
    muted.gain.value = 0;
    this.processor.connect(muted);
    muted.connect(this.ctx.destination);
    this.processor.onaudioprocess = (e) => {
      this.buffer.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.timer = setInterval(() => void this.flush(), WINDOW_MS);
    this.onState('live');
    return true;
  }

  /** Mix in a participant who joined mid-transcription. */
  addAudio(stream: MediaStream) {
    if (!this.ctx || !this.mix || this.sources.has(stream)) return;
    if (stream.getAudioTracks().length === 0) return;
    this.sources.add(stream);
    this.ctx.createMediaStreamSource(stream).connect(this.mix);
  }

  private async flush(): Promise<void> {
    if (this.busy || !this.asr || this.buffer.length === 0) return;
    const chunks = this.buffer;
    this.buffer = [];
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    if (samples.length < SAMPLE_RATE) return; // under a second — noise, skip
    this.busy = true;
    try {
      const out = await this.asr(samples);
      const text = (Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : (out.text ?? '')).trim();
      // Whisper hallucinates fillers on silence; only surface real speech.
      if (text && !/^[[(]/.test(text)) this.onText(text);
    } catch {
      // one bad window shouldn't kill the session
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    this.processor?.disconnect();
    this.mix?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.processor = null;
    this.mix = null;
    this.buffer = [];
    this.sources.clear();
  }
}
