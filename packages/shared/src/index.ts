export type ChannelType = 'public' | 'private' | 'dm';

export const THEMES = ['paper', 'midnight', 'forest', 'sunset', 'ocean', 'mono'] as const;
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
  /** The fun side: things this person chose to share. */
  interests: string[];
  /** What they're currently listening to / watching / into. */
  nowPlaying: string | null;
}

/** The signed-in user: profile plus personal settings. */
export interface MeDto extends UserDto {
  theme: Theme;
  /** When the current status auto-clears (null = keeps until changed). */
  statusExpiresAt: string | null;
  /** People this user has blocked — their content is hidden everywhere. */
  blockedUserIds: string[];
}

/** A message written now, delivering later. */
export interface ScheduledMessageDto {
  id: string;
  channelId: string;
  body: string;
  sendAt: string;
}

/** The P2P space this instance belongs to. */
export interface SpaceDto {
  name: string;
  /** Shareable invite: high-entropy key, unguessable. */
  invite: string;
  connectedPeers: number;
}

export interface ProfilePatch {
  name?: string;
  title?: string | null;
  team?: string | null;
  avatarEmoji?: string | null;
  statusEmoji?: string | null;
  statusText?: string | null;
  /** Minutes until the status clears itself; null/omitted = keep until changed. */
  statusExpiresInMinutes?: number | null;
  interests?: string[];
  nowPlaying?: string | null;
  theme?: Theme;
}

/** A person you might connect with, and why. */
export interface PeopleSuggestion {
  user: UserDto;
  sharedInterests: string[];
}

/** Enough people share an interest that a group might be worth starting. */
export interface GroupSuggestion {
  interest: string;
  members: UserDto[];
  /** An existing non-archived channel already named after the interest. */
  existingChannelId: string | null;
}

export interface ConnectDto {
  people: PeopleSuggestion[];
  groups: GroupSuggestion[];
}

export interface ChannelDto {
  id: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  /** Archived channels are read-only and tucked away, but stay searchable. */
  archivedAt: string | null;
  /** Favourite position (0-based) when pinned, null otherwise. */
  pinned: number | null;
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

/** A code path, repo, or link that conversations keep referring to. */
export interface ArtifactRef {
  ref: string;
  kind: 'code' | 'link';
  mentions: number;
  /** Where it was (most recently) mentioned, for click-through. */
  channelId: string;
  channelName: string;
}

/** Task scoping: feed in requirements, get who/what/where to start from. */
export interface TaskScopeDto {
  query: string;
  matchCount: number;
  people: AskPerson[];
  threads: AskThread[];
  artifacts: ArtifactRef[];
}

/**
 * A user's productivity profile page. Everything is filtered to what the
 * *viewer* may read, and DM content never appears regardless of viewer.
 */
export interface ProfilePageDto {
  user: UserDto;
  stats: {
    messages: number;
    reactionsReceived: number;
    channelsActive: number;
  };
  topChannels: { id: string; name: string; count: number }[];
  /** Everyone on the same team — the mini org chart. */
  teammates: UserDto[];
  /** Their most-engaged messages (reactions + replies). */
  popular: MessageDto[];
  /** Code paths and links they keep referencing. */
  artifacts: ArtifactRef[];
  recent: MessageDto[];
}

/** A widely-engaged thread for the Home digest. */
export interface HomePopular {
  rootId: string;
  channelId: string;
  channelName: string;
  authorName: string;
  snippet: string;
  replyCount: number;
  reactionCount: number;
}

/** One unread conversation on the Home screen, with its latest message. */
export interface HomeUnread {
  channelId: string;
  name: string;
  type: ChannelType;
  unreadCount: number;
  dmPartnerNames?: string[];
  latestAuthor: string;
  latestSnippet: string;
  latestAt: string;
}

/** A thread the user participates in, surfaced by recent reply activity. */
export interface HomeThread {
  rootId: string;
  channelId: string;
  channelName: string;
  rootAuthorName: string;
  rootSnippet: string;
  replyCount: number;
  lastReplyAt: string;
  lastReplyAuthor: string;
}

export interface HomeDto {
  unread: HomeUnread[];
  threads: HomeThread[];
  popular: HomePopular[];
}

/** Server → client realtime events. */
export type ServerEvent =
  | { type: 'message.created'; message: MessageDto }
  | { type: 'reaction.changed'; channelId: string; messageId: string; emoji: string; userId: string; added: boolean }
  | { type: 'presence.changed'; onlineUserIds: string[] }
  | { type: 'user.updated'; user: UserDto }
  /** A channel was created, archived, or unarchived — refetch the list. */
  | { type: 'channels.changed' }
  /** P2P peers connected to this instance's space. */
  | { type: 'p2p.peers'; count: number }
  /** Campfire (call) membership changed in a channel. */
  | { type: 'call.changed'; channelId: string; participants: string[] }
  /** WebRTC signaling relayed between two users. */
  | { type: 'rtc.signal'; from: string; payload: RtcPayload };

/** SDP offer/answer or ICE candidate, passed through the server verbatim. */
export interface RtcPayload {
  sdp?: { type: string; sdp?: string };
  candidate?: unknown;
}

/** Client → server over the websocket. */
export type ClientEvent = { type: 'rtc.signal'; to: string; payload: RtcPayload };
