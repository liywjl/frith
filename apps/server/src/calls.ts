// Campfires: lightweight call membership per channel, in memory — the media
// itself flows peer-to-peer over WebRTC; the server only tracks who's around
// the fire and relays signaling.
import type { ServerEvent } from '@app/shared';
import { channelAudience } from './store.js';
import { publish } from './realtime.js';

const calls = new Map<string, Set<string>>(); // channelId → userIds

async function announce(channelId: string): Promise<void> {
  const participants = [...(calls.get(channelId) ?? [])];
  const event: ServerEvent = { type: 'call.changed', channelId, participants };
  publish(event, await channelAudience(channelId));
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
  await announce(channelId);
}

/** Someone's last socket closed — they leave every campfire they were in. */
export async function leaveAllCalls(userId: string): Promise<void> {
  for (const [channelId, members] of calls) {
    if (members.has(userId)) await leaveCall(channelId, userId);
  }
}

/** Snapshot for clients on load. */
export function activeCalls(): Record<string, string[]> {
  return Object.fromEntries([...calls.entries()].map(([id, members]) => [id, [...members]]));
}
