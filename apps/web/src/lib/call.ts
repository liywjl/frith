import type { RtcPayload } from '@app/shared';
import { sendClientEvent } from './useRealtime';

/**
 * Campfire media: a WebRTC mesh — every participant connects directly to
 * every other; the server only relays signaling. Joining without mic
 * permission degrades to listen-only rather than failing.
 */
export class CallManager {
  private peers = new Map<string, RTCPeerConnection>();
  /** Every stream a peer has sent us, by stream id — classified on emit. */
  private received = new Map<string, Map<string, MediaStream>>();
  /** Each peer's announced screen-share stream id (null = not sharing). */
  private screenIds = new Map<string, string | null>();
  private streams = new Map<string, MediaStream>();
  private screens = new Map<string, MediaStream>();
  local: MediaStream | null = null;
  screen: MediaStream | null = null;
  /** Fired when the browser's own "Stop sharing" chrome ends the capture. */
  onShareEnd: (() => void) | null = null;
  private channelId: string | null = null;

  constructor(private onStreams: (streams: Map<string, MediaStream>, screens: Map<string, MediaStream>) => void) {}

  async join(channelId: string, video: boolean, others: string[]): Promise<void> {
    this.channelId = channelId;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      this.local = null; // listen-only
    }
    for (const id of others) this.newPeer(id);
    await this.renegotiate();
  }

  private newPeer(userId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection();
    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    if (this.screen) for (const track of this.screen.getTracks()) pc.addTrack(track, this.screen);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(userId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const byId = this.received.get(userId) ?? new Map<string, MediaStream>();
      byId.set(stream.id, stream);
      this.received.set(userId, byId);
      this.classify(userId);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.drop(userId);
    };
    this.peers.set(userId, pc);
    return pc;
  }

  /** Sort a peer's incoming streams into camera vs screen and re-emit. */
  private classify(userId: string) {
    const byId = this.received.get(userId) ?? new Map<string, MediaStream>();
    const screenId = this.screenIds.get(userId) ?? null;
    const screen = screenId ? byId.get(screenId) : undefined;
    const camera = [...byId.values()].find((s) => s.id !== screenId);
    if (camera) this.streams.set(userId, camera);
    else this.streams.delete(userId);
    if (screen) this.screens.set(userId, screen);
    else this.screens.delete(userId);
    this.onStreams(new Map(this.streams), new Map(this.screens));
  }

  async handleSignal(from: string, payload: RtcPayload): Promise<void> {
    if (!this.channelId) return;
    if (payload.screen !== undefined) {
      this.screenIds.set(from, payload.screen);
      this.classify(from);
    }
    let pc = this.peers.get(from);
    if (payload.sdp) {
      if (payload.sdp.type === 'offer') {
        pc ??= this.newPeer(from);
        await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sdpSignal(from, answer);
      } else if (pc) {
        await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      }
    } else if (payload.candidate && pc) {
      try {
        await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
      } catch {
        // candidate raced the answer; harmless
      }
    }
  }

  private signal(to: string, payload: RtcPayload) {
    sendClientEvent({ type: 'rtc.signal', to, payload });
  }

  /** SDP always rides with the current screen-share id, so a peer can tell
   *  which of our streams is the screen — even joining mid-share. */
  private sdpSignal(to: string, desc: { type: string; sdp?: string | null }) {
    this.signal(to, { sdp: { type: desc.type, sdp: desc.sdp ?? undefined }, screen: this.screen?.id ?? null });
  }

  /** Fresh offers to every peer — after any track add/remove. */
  private async renegotiate(): Promise<void> {
    for (const [id, pc] of this.peers) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sdpSignal(id, offer);
    }
  }

  /** Share this screen with the campfire; false if the user declined. */
  async shareScreen(): Promise<boolean> {
    if (this.screen) return true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return false;
    }
    this.screen = stream;
    const track = stream.getVideoTracks()[0]!;
    track.onended = () => {
      // The browser's own "Stop sharing" pill — mirror it into the call.
      void this.stopShare();
      this.onShareEnd?.();
    };
    for (const pc of this.peers.values()) pc.addTrack(track, stream);
    await this.renegotiate();
    return true;
  }

  async stopShare(): Promise<void> {
    if (!this.screen) return;
    const tracks = new Set(this.screen.getTracks());
    for (const t of tracks) t.stop();
    this.screen = null;
    for (const pc of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track && tracks.has(sender.track)) pc.removeTrack(sender);
      }
    }
    await this.renegotiate();
  }

  /** Drop peers who left, per the server's participant list. */
  prune(participants: string[]) {
    for (const id of [...this.peers.keys()]) {
      if (!participants.includes(id)) this.drop(id);
    }
  }

  private drop(userId: string) {
    this.peers.get(userId)?.close();
    this.peers.delete(userId);
    this.received.delete(userId);
    this.screenIds.delete(userId);
    this.streams.delete(userId);
    this.screens.delete(userId);
    this.onStreams(new Map(this.streams), new Map(this.screens));
  }

  setMuted(muted: boolean) {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Turn the camera on mid-call, even when joined audio-only (renegotiates). */
  async enableCamera(): Promise<boolean> {
    if (this.local && this.local.getVideoTracks().length > 0) {
      this.setVideoEnabled(true);
      return true;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0]!;
      if (this.local) this.local.addTrack(track);
      else this.local = cam;
      for (const pc of this.peers.values()) pc.addTrack(track, this.local);
    } catch {
      return false;
    }
    await this.renegotiate();
    return true;
  }

  setVideoEnabled(on: boolean) {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  leave() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.screen?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.screen = null;
    this.channelId = null;
  }
}
