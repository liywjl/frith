// Lore's entire dataset, materialized in memory from the space's Autobase
// log. Every mutation in the app is an Op appended to the log; this class is
// the deterministic reducer that turns the linearized ops back into state —
// on every peer, identically.

export interface UserRow {
  id: string;
  handle: string;
  name: string;
  title: string | null;
  team: string | null;
  avatarEmoji: string | null;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  interests: string[];
  nowPlaying: string | null;
  theme: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  type: 'public' | 'private' | 'dm';
  topic: string | null;
  archivedAt: string | null;
}

export interface MessageRow {
  id: string;
  channelId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string;
  createdAt: string;
}

export interface AttachmentRow {
  id: string;
  messageId: string;
  name: string;
  mime: string;
  size: number;
}

export interface ScheduledRow {
  id: string;
  channelId: string;
  authorId: string;
  parentMessageId: string | null;
  body: string;
  sendAt: string;
}

export type Op =
  | { t: 'add-writer'; key: string } // appended by a member when pairing admits a new instance
  | { t: 'space'; name: string }
  | { t: 'user'; id: string; patch: Partial<UserRow> & Pick<UserRow, 'handle' | 'name'> }
  | { t: 'channel'; channel: ChannelRow }
  | { t: 'archive'; channelId: string; archived: boolean; at: string }
  | { t: 'member'; channelId: string; userId: string }
  | { t: 'msg'; message: MessageRow }
  | { t: 'att'; attachment: AttachmentRow }
  | { t: 'react'; messageId: string; userId: string; emoji: string; on: boolean }
  | { t: 'read'; userId: string; channelId: string; at: string }
  | { t: 'block'; userId: string; blockedId: string; on: boolean }
  | { t: 'pin'; userId: string; channelId: string; on: boolean }
  | { t: 'pins'; userId: string; channelIds: string[] }
  | { t: 'sched'; scheduled: ScheduledRow }
  | { t: 'unsched'; id: string };

const defaultUser = (id: string): UserRow => ({
  id,
  handle: '',
  name: '',
  title: null,
  team: null,
  avatarEmoji: null,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  interests: [],
  nowPlaying: null,
  theme: 'paper',
});

export class LoreState {
  spaceName: string | null = null;
  users = new Map<string, UserRow>();
  channels = new Map<string, ChannelRow>();
  members = new Map<string, Set<string>>(); // channelId → userIds
  messages = new Map<string, MessageRow>();
  messagesByChannel = new Map<string, string[]>();
  reactions = new Map<string, Map<string, true>>(); // messageId → `${userId}:${emoji}`
  reads = new Map<string, string>(); // `${userId}:${channelId}` → ISO
  blocks = new Map<string, Set<string>>();
  pins = new Map<string, Map<string, number>>(); // userId → channelId → position
  scheduled = new Map<string, ScheduledRow>();
  attachments = new Map<string, AttachmentRow>();
  attachmentsByMessage = new Map<string, AttachmentRow[]>();

  memberSet(channelId: string): Set<string> {
    let set = this.members.get(channelId);
    if (!set) {
      set = new Set();
      this.members.set(channelId, set);
    }
    return set;
  }

  apply(op: Op): void {
    switch (op.t) {
      case 'add-writer':
        break; // writer management happens at the autobase level

      case 'space':
        this.spaceName = op.name;
        break;
      case 'user': {
        const current = this.users.get(op.id) ?? defaultUser(op.id);
        this.users.set(op.id, { ...current, ...op.patch, id: op.id });
        break;
      }
      case 'channel':
        if (!this.channels.has(op.channel.id)) this.channels.set(op.channel.id, op.channel);
        break;
      case 'archive': {
        const channel = this.channels.get(op.channelId);
        if (channel) channel.archivedAt = op.archived ? op.at : null;
        break;
      }
      case 'member':
        this.memberSet(op.channelId).add(op.userId);
        break;
      case 'msg':
        if (this.messages.has(op.message.id)) break;
        this.messages.set(op.message.id, op.message);
        this.messagesByChannel.set(op.message.channelId, [
          ...(this.messagesByChannel.get(op.message.channelId) ?? []),
          op.message.id,
        ]);
        break;
      case 'att': {
        this.attachments.set(op.attachment.id, op.attachment);
        this.attachmentsByMessage.set(op.attachment.messageId, [
          ...(this.attachmentsByMessage.get(op.attachment.messageId) ?? []),
          op.attachment,
        ]);
        break;
      }
      case 'react': {
        let set = this.reactions.get(op.messageId);
        if (!set) {
          set = new Map();
          this.reactions.set(op.messageId, set);
        }
        const key = `${op.userId}:${op.emoji}`;
        if (op.on) set.set(key, true);
        else set.delete(key);
        break;
      }
      case 'read':
        this.reads.set(`${op.userId}:${op.channelId}`, op.at);
        break;
      case 'block': {
        let set = this.blocks.get(op.userId);
        if (!set) {
          set = new Set();
          this.blocks.set(op.userId, set);
        }
        if (op.on) set.add(op.blockedId);
        else set.delete(op.blockedId);
        break;
      }
      case 'pin': {
        let map = this.pins.get(op.userId);
        if (!map) {
          map = new Map();
          this.pins.set(op.userId, map);
        }
        if (op.on) {
          if (!map.has(op.channelId)) map.set(op.channelId, Math.max(-1, ...map.values()) + 1);
        } else map.delete(op.channelId);
        break;
      }
      case 'pins': {
        const map = this.pins.get(op.userId);
        if (!map) break;
        op.channelIds.forEach((id, position) => {
          if (map.has(id)) map.set(id, position);
        });
        break;
      }
      case 'sched':
        this.scheduled.set(op.scheduled.id, op.scheduled);
        break;
      case 'unsched':
        this.scheduled.delete(op.id);
        break;
    }
  }
}
