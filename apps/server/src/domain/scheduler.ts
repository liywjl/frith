// Schedule-send delivery: claim due messages and post them exactly as if the
// author had hit Enter at that moment. The op fan-out handles the websocket
// events, and the space log syncs the message to peers like any other.
import { claimDueScheduled, createMessage, getChannel } from './store.js';
import { space } from '../space/space.js';

export async function deliverDueScheduled(): Promise<number> {
  const due = await claimDueScheduled();
  for (const item of due) {
    const channel = await getChannel(item.channelId);
    if (!channel || channel.archivedAt) continue; // channel archived since scheduling — drop
    // Scheduled bodies are stored encrypted; decrypt here so createMessage can
    // re-seal under the CURRENT key (it may have rotated since scheduling).
    // Undecryptable (author's key revoked since) → drop rather than post junk.
    const body = space.decryptBody(item.body);
    if (body === null) continue;
    await createMessage({
      channelId: item.channelId,
      authorId: item.authorId,
      body,
      parentMessageId: item.parentMessageId,
    });
  }
  return due.length;
}
