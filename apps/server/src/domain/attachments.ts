// Attachment byte movement, shared by both edges (the HTTP server and the
// mobile worklet): policy-gated auto-fetch when a message arrives, and the
// cache-fill + decrypt path behind every explicit file read. The edges differ
// only in how they publish events and who counts as "at this device".
import type { ServerEvent } from '@app/shared';
import { space } from '../space/space.js';
import type { AttachmentRow } from '../space/state.js';
import { channelAudience } from './store.js';
import { getPolicies, mb } from './policies.js';

type Publish = (event: ServerEvent, audience: 'all' | string[]) => void;

/**
 * Warm the local cache for a just-arrived message's files — within this
 * device's policies, and never for authors someone at this device blocked.
 */
export async function autoFetchAttachments(
  message: { id: string; channelId: string; authorId: string; createdAt: string },
  opts: { blockedLocally: (authorId: string) => boolean; publish: Publish },
): Promise<void> {
  const policies = getPolicies();
  const attachments = space.state.attachmentsByMessage.get(message.id) ?? [];
  const tooOld = Date.now() - new Date(message.createdAt).getTime() > policies.autoFetchRecentDays * 86_400_000;
  if (tooOld || opts.blockedLocally(message.authorId)) return;
  for (const a of attachments) {
    if (!a.blob || space.blobs.isOwn(a.blob) || a.size > mb(policies.autoFetchMB)) continue;
    // `a.size` is the poster's claim, and this fetch is unprompted — so the
    // policy, not the claim, is what actually bounds the read.
    const bytes = await space.blobs
      .get(a.blob, { wait: true, expectedHash: a.hash, maxBytes: mb(policies.autoFetchMB) })
      .catch(() => null);
    if (!bytes) continue;
    opts.publish(
      { type: 'file.cached', channelId: message.channelId, messageId: message.id, attachmentId: a.id },
      await channelAudience(message.channelId),
    );
  }
  await space.blobs.enforceBudget(mb(policies.storageBudgetMB));
}

/**
 * Read an attachment's bytes — from this device, or (when `wait`) from
 * whichever peer holds them. A fresh cache fill announces itself and keeps
 * the device under its storage budget; sealed bytes decrypt with the
 * channel's content key or report `locked` (removed before it was shared).
 */
export async function fetchAttachmentBytes(
  attachment: { id: string; messageId: string; channelId: string; hash?: string; blob: NonNullable<AttachmentRow['blob']> },
  wait: boolean,
  publish: Publish,
): Promise<{ status: 'needs-fetch' } | { status: 'locked' } | { status: 'ok'; clear: Buffer }> {
  const wasCached = space.blobs.isCachedSync(attachment.blob);
  // An explicit "download this" may be large, but not unbounded: this device's
  // own upload ceiling is the most it ever agreed to handle.
  const bytes = await space.blobs.get(attachment.blob, {
    wait,
    expectedHash: attachment.hash,
    maxBytes: mb(getPolicies().maxUploadMB),
  });
  if (!bytes) return { status: 'needs-fetch' };
  if (!wasCached) {
    publish(
      { type: 'file.cached', channelId: attachment.channelId, messageId: attachment.messageId, attachmentId: attachment.id },
      await channelAudience(attachment.channelId),
    );
    void space.blobs.enforceBudget(mb(getPolicies().storageBudgetMB));
  }
  const clear = space.decryptBytes(bytes);
  if (!clear) return { status: 'locked' };
  return { status: 'ok', clear };
}
