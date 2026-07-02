export type ChannelType = 'public' | 'private' | 'dm';

export const THEMES = ['paper', 'midnight', 'forest', 'sunset'] as const;
export type Theme = (typeof THEMES)[number];

export interface UserDto {
  id: string;
  handle: string;
  name: string;
  title: string | null;
  team: string | null;
  avatarEmoji: string | null;
  statusEmoji: string | null;
  statusText: string | null;
}

/** The signed-in user: profile plus personal settings. */
export interface MeDto extends UserDto {
  theme: Theme;
}

export interface ProfilePatch {
  name?: string;
  title?: string | null;
  team?: string | null;
  avatarEmoji?: string | null;
  statusEmoji?: string | null;
  statusText?: string | null;
  theme?: Theme;
}

export interface ChannelDto {
  id: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  unreadCount: number;
  /** For DMs: the other participants' names, used as the display label. */
  dmPartnerNames?: string[];
  /** For DMs: the other participants' user ids (presence dots, dedupe). */
  dmPartnerIds?: string[];
}

export interface ReactionDto {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorAvatarEmoji: string | null;
  parentMessageId: string | null;
  body: string;
  createdAt: string;
  replyCount: number;
  reactions: ReactionDto[];
}

/**
 * Ask retrieval results (v0: Postgres full-text search, ACL-filtered).
 * Snippets mark query hits with [[double brackets]] so clients can highlight
 * without rendering HTML.
 */
export interface AskEvidence {
  messageId: string;
  channelId: string;
  channelName: string;
  snippet: string;
  createdAt: string;
}

export interface AskPerson {
  user: UserDto;
  score: number;
  evidence: AskEvidence[];
}

export interface AskThread {
  rootId: string;
  channelId: string;
  channelName: string;
  rootBody: string;
  rootAuthorName: string;
  matchCount: number;
  topSnippet: string;
  lastActivityAt: string;
}

export interface AskResponse {
  query: string;
  people: AskPerson[];
  threads: AskThread[];
  messages: AskEvidence[];
}

/** Server → client realtime events. */
export type ServerEvent =
  | { type: 'message.created'; message: MessageDto }
  | { type: 'reaction.changed'; channelId: string; messageId: string; emoji: string; userId: string; added: boolean }
  | { type: 'presence.changed'; onlineUserIds: string[] }
  | { type: 'user.updated'; user: UserDto };
