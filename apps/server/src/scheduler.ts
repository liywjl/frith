// Schedule-send delivery: claim due messages and post them exactly as if the
// author had hit Enter at that moment — local broadcast and P2P fan-out both.
import { channelAudience, claimDueScheduled, createMessage, getChannel, getUserById } from './store.js';
import { publish } from './realtime.js';
import { broadcastLocalMessage } from './p2p/bridge.js';

export async function deliverDueScheduled(): Promise<number> {
  const due = await claimDueScheduled();
  for (const item of due) {
    const channel = await getChannel(item.channelId);
    if (!channel || channel.archivedAt) continue; // channel archived since scheduling — drop
    const message = await createMessage({
      channelId: item.channelId,
      authorId: item.authorId,
      body: item.body,
      parentMessageId: item.parentMessageId,
    });
    publish({ type: 'message.created', message }, await channelAudience(item.channelId));
    const author = await getUserById(item.authorId);
    if (author) broadcastLocalMessage(message, channel, author);
  }
  return due.length;
}
