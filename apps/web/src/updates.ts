import type { MessageDto, ServerEvent } from '@app/shared';

/** Apply a reaction.changed event to a message list (channel feed or thread). */
export function applyReaction(
  list: MessageDto[],
  event: Extract<ServerEvent, { type: 'reaction.changed' }>,
  meId: string,
): MessageDto[] {
  return list.map((m) => {
    if (m.id !== event.messageId) return m;
    const existing = m.reactions.find((r) => r.emoji === event.emoji);
    const delta = event.added ? 1 : -1;
    const mine = event.userId === meId ? event.added : (existing?.mine ?? false);
    const next = existing
      ? m.reactions
          .map((r) => (r.emoji === event.emoji ? { ...r, count: r.count + delta, mine } : r))
          .filter((r) => r.count > 0)
      : event.added
        ? [...m.reactions, { emoji: event.emoji, count: 1, mine }]
        : m.reactions;
    return { ...m, reactions: next };
  });
}
