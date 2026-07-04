// Schedule-send delivery: claim due messages and post them exactly as if the
// author had hit Enter at that moment. The op fan-out handles the websocket
// events, and the space log syncs the message to peers like any other.
import { claimDueScheduled, createMessage, getChannel } from './store.js';

export async function deliverDueScheduled(): Promise<number> {
  const due = await claimDueScheduled();
  for (const item of due) {
    const channel = await getChannel(item.channelId);
    if (!channel || channel.archivedAt) continue; // channel archived since scheduling — drop
    await createMessage({
      channelId: item.channelId,
      authorId: item.authorId,
      body: item.body,
      parentMessageId: item.parentMessageId,
    });
  }
  return due.length;
}
