/**
 * Records the campfire on THIS device: every participant's audio mixed into
 * one track, plus the shared screen's video when one is on stage at start.
 * The result is handed back as a blob — the caller posts it to the channel,
 * where it's sealed like any other attachment. Nothing streams anywhere.
 */
export class CallRecorder {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private sources = new Set<MediaStream>();

  get running(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(audioStreams: (MediaStream | null)[], stageVideo: MediaStream | null): boolean {
    if (this.running) return true;
    this.ctx = new AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
    for (const stream of audioStreams) if (stream) this.addAudio(stream);
    const tracks: MediaStreamTrack[] = [...this.dest.stream.getAudioTracks()];
    const videoTrack = stageVideo?.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);
    const mixed = new MediaStream(tracks);
    try {
      this.recorder = new MediaRecorder(mixed, { mimeType: videoTrack ? 'video/webm' : 'audio/webm' });
    } catch {
      try {
        this.recorder = new MediaRecorder(mixed); // browser picks the container
      } catch {
        void this.ctx.close();
        this.ctx = null;
        this.dest = null;
        return false;
      }
    }
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    return true;
  }

  /** Mix in a participant who joined (or turned their mic on) mid-recording. */
  addAudio(stream: MediaStream) {
    if (!this.ctx || !this.dest || this.sources.has(stream)) return;
    if (stream.getAudioTracks().length === 0) return;
    this.sources.add(stream);
    this.ctx.createMediaStreamSource(stream).connect(this.dest);
  }

  /** Stop and collect the file; null when nothing was captured. */
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') return null;
    const flushed = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await flushed;
    void this.ctx?.close();
    this.ctx = null;
    this.dest = null;
    this.recorder = null;
    this.sources.clear();
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.chunks = [];
    return blob.size > 0 ? blob : null;
  }
}
