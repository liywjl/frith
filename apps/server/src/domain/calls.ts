// Campfires: lightweight call membership per channel, in memory — the media
// itself flows peer-to-peer over WebRTC; the server only tracks who's around
// the fire and relays signaling.
import type { ServerEvent } from '@app/shared';
import { channelAudience } from './store.js';
import { publish } from '../api/realtime.js';

const calls = new Map<string, Set<string>>(); // channelId → userIds
const recorders = new Map<string, Set<string>>(); // channelId → userIds recording

async function announce(channelId: string): Promise<void> {
  const participants = [...(calls.get(channelId) ?? [])];
  const event: ServerEvent = { type: 'call.changed', channelId, participants };
  publish(event, await channelAudience(channelId));
}

async function announceRecording(channelId: string): Promise<void> {
  const event: ServerEvent = { type: 'call.recording', channelId, recorders: [...(recorders.get(channelId) ?? [])] };
  publish(event, await channelAudience(channelId));
}

/** Flag (or unflag) a participant as recording — everyone in the channel is
 *  told who is recording, and joiners see it before they step in. */
export async function setRecording(channelId: string, userId: string, on: boolean): Promise<'ok' | 'not-in-call'> {
  if (!calls.get(channelId)?.has(userId)) return 'not-in-call';
  const set = recorders.get(channelId) ?? new Set<string>();
  if (on) set.add(userId);
  else set.delete(userId);
  if (set.size > 0) recorders.set(channelId, set);
  else recorders.delete(channelId);
  await announceRecording(channelId);
  return 'ok';
}

/** Join; returns the participants who were already there (to offer to). */
export async function joinCall(channelId: string, userId: string): Promise<string[]> {
  const current = calls.get(channelId) ?? new Set<string>();
  const others = [...current].filter((id) => id !== userId);
  current.add(userId);
  calls.set(channelId, current);
  await announce(channelId);
  return others;
}

export async function leaveCall(channelId: string, userId: string): Promise<void> {
  const current = calls.get(channelId);
  if (!current?.delete(userId)) return;
  if (current.size === 0) calls.delete(channelId);
  // Leaving ends your recording flag — the room must never show a stale REC.
  const rec = recorders.get(channelId);
  if (rec?.delete(userId)) {
    if (rec.size === 0) recorders.delete(channelId);
    await announceRecording(channelId);
  }
  await announce(channelId);
}

/** Someone's last socket closed — they leave every campfire they were in. */
export async function leaveAllCalls(userId: string): Promise<void> {
  for (const [channelId, members] of calls) {
    if (members.has(userId)) await leaveCall(channelId, userId);
  }
}

/** Snapshot for clients on load: who's around each fire, and who's recording. */
export function activeCalls(): { calls: Record<string, string[]>; recorders: Record<string, string[]> } {
  return {
    calls: Object.fromEntries([...calls.entries()].map(([id, members]) => [id, [...members]])),
    recorders: Object.fromEntries([...recorders.entries()].map(([id, ids]) => [id, [...ids]])),
  };
}
