import type { RtcPayload } from '@app/shared';
import { sendClientEvent } from './useRealtime';

/**
 * Campfire media: a WebRTC mesh — every participant connects directly to
 * every other; the server only relays signaling. Joining without mic
 * permission degrades to listen-only rather than failing.
 */
export class CallManager {
  private peers = new Map<string, RTCPeerConnection>();
  private streams = new Map<string, MediaStream>();
  local: MediaStream | null = null;
  private channelId: string | null = null;

  constructor(private onStreams: (streams: Map<string, MediaStream>) => void) {}

  async join(channelId: string, video: boolean, others: string[]): Promise<void> {
    this.channelId = channelId;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      this.local = null; // listen-only
    }
    for (const id of others) {
      const pc = this.newPeer(id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal(id, { sdp: { type: offer.type, sdp: offer.sdp ?? undefined } });
    }
  }

  private newPeer(userId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection();
    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(userId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.streams.set(userId, stream);
      this.onStreams(new Map(this.streams));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.drop(userId);
    };
    this.peers.set(userId, pc);
    return pc;
  }

  async handleSignal(from: string, payload: RtcPayload): Promise<void> {
    if (!this.channelId) return;
    let pc = this.peers.get(from);
    if (payload.sdp) {
      if (payload.sdp.type === 'offer') {
        pc ??= this.newPeer(from);
        await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal(from, { sdp: { type: answer.type, sdp: answer.sdp ?? undefined } });
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

  /** Drop peers who left, per the server's participant list. */
  prune(participants: string[]) {
    for (const id of [...this.peers.keys()]) {
      if (!participants.includes(id)) this.drop(id);
    }
  }

  private drop(userId: string) {
    this.peers.get(userId)?.close();
    this.peers.delete(userId);
    this.streams.delete(userId);
    this.onStreams(new Map(this.streams));
  }

  setMuted(muted: boolean) {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setVideoEnabled(on: boolean) {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  leave() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.channelId = null;
  }
}
