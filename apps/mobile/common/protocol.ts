// The wire between the React Native UI and the Bare worklet: length-prefixed
// JSON frames over BareKit's IPC duplex. Three frame shapes travel on it:
//   request   { id, method, params? }         UI → worklet
//   response  { id, ok, result | error }      worklet → UI
//   push      { event: ServerEvent }          worklet → UI (realtime fan-out)
// Same premise as the desktop app's HTTP + websocket pair — collapsed onto
// one in-process pipe, since the "server" lives inside the app.
import b4a from 'b4a';
import type { MeDto, PoliciesDto, SpaceDto, SpaceListDto } from '@app/shared';

/** What `init`, `hello`, and the space/profile mutations resolve to — the
 *  client's routing state (who am I, which space, which spaces exist). */
export interface HelloDto {
  me: MeDto | null;
  space: SpaceDto;
  spaces: SpaceListDto;
  policies: PoliciesDto;
  /** Dev/seeded build: pick-a-user auth is available (dev.login). */
  dev: boolean;
}

/** 4-byte little-endian length prefix + UTF-8 JSON. */
export function encodeFrame(value: unknown): Uint8Array {
  const body = b4a.from(JSON.stringify(value), 'utf8');
  const frame = new Uint8Array(4 + body.byteLength);
  new DataView(frame.buffer).setUint32(0, body.byteLength, true);
  frame.set(body, 4);
  return frame;
}

/** Incremental decoder — IPC chunks don't align with frame boundaries. */
export class FrameDecoder {
  private pending: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    const merged = new Uint8Array(this.pending.byteLength + chunk.byteLength);
    merged.set(this.pending, 0);
    merged.set(chunk, this.pending.byteLength);
    this.pending = merged;

    const frames: unknown[] = [];
    while (this.pending.byteLength >= 4) {
      const view = new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength);
      const size = view.getUint32(0, true);
      if (this.pending.byteLength < 4 + size) break;
      const body = this.pending.subarray(4, 4 + size);
      this.pending = this.pending.slice(4 + size);
      frames.push(JSON.parse(b4a.toString(body, 'utf8')));
    }
    return frames;
  }
}
