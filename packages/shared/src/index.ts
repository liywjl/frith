export type ChannelType = 'public' | 'private' | 'dm';

export const THEMES = ['bubbly', 'paper', 'midnight', 'forest', 'sunset', 'ocean', 'mono'] as const;
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

/** All spaces on this device — one is open at a time. */
export interface SpaceListDto {
  active: string;
  spaces: { dir: string; name: string }[];
}

/** A shared file with its chat context, for the Files view. */
export interface FileDto extends AttachmentDto {
  messageId: string;
  channelId: string;
  channelName: string;
  authorName: string;
  createdAt: string;
}

export type AddonKind = 'checklist' | 'links' | 'notes';

export interface AddonItemDto {
  id: string;
  text: string;
  url: string | null;
  done: boolean;
  authorName: string;
  createdAt: string;
}

/** A custom tab members added to the space — synced P2P like everything else. */
export interface AddonDto {
  id: string;
  name: string;
  emoji: string;
  kind: AddonKind;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  items: AddonItemDto[];
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
  /** When the channel last saw a message (null = never). */
  lastActivityAt: string | null;
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

export interface AttachmentDto {
  id: string;
  /** Broad type for rendering: image, video, audio, or a generic file. */
  kind: 'image' | 'video' | 'audio' | 'file';
  name: string;
  url: string;
  size: number;
  /** Bytes are on this device — render/serve immediately. False = a click
   *  (or auto-fetch policy) pulls them from whichever peer holds them. */
  cached: boolean;
  /** Could execute if opened carelessly — never rendered inline. */
  dangerous: boolean;
}

/** Device-local storage policies — what THIS machine stores and downloads. */
export interface PoliciesDto {
  maxUploadMB: number;
  autoFetchMB: number;
  autoFetchRecentDays: number;
  storageBudgetMB: number;
}

export interface StorageDto {
  policies: PoliciesDto;
  usage: {
    /** Bytes of other peers' files cached on this device (evictable). */
    cachedBytes: number;
    cachedCount: number;
  };
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
  attachments: AttachmentDto[];
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

/** A hit from this device's local library (files/repos the user indexed). */
export interface AskLocalHit {
  kind: 'file' | 'commit';
  sourceId: string;
  sourceName: string;
  /** Relative file path, or short commit sha. */
  ref: string;
  /** File name, or commit subject line. */
  title: string;
  snippet: string;
  /** File mtime or commit date (ISO). */
  when: string;
}

/** A shared file that matched — by name, or by content when cached here. */
export interface AskFileHit {
  attachmentId: string;
  channelId: string;
  channelName: string;
  name: string;
  kind: AttachmentDto['kind'];
  url: string;
  snippet: string | null;
}

export interface AskResponse {
  query: string;
  people: AskPerson[];
  threads: AskThread[];
  messages: AskEvidence[];
  /** Files shared in the space (ACL-filtered, like everything else). */
  files: AskFileHit[];
  /** From this device's library — never shared into the space. */
  local: AskLocalHit[];
}

/** A local folder/repo indexed into Ask on this device only. */
export interface LibrarySourceDto {
  id: string;
  name: string;
  path: string;
  /** Indexed text/code files. */
  fileCount: number;
  /** Indexed git commits (0 when the folder isn't a repo). */
  commitCount: number;
  indexedAt: string | null;
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
  /** A file's bytes finished downloading to this device. */
  | { type: 'file.cached'; channelId: string; messageId: string; attachmentId: string }
  /** An add-on tab (or its items) changed — refetch the list. */
  | { type: 'addons.changed' }
  /** WebRTC signaling relayed between two users. */
  | { type: 'rtc.signal'; from: string; payload: RtcPayload };

/** SDP offer/answer or ICE candidate, passed through the server verbatim. */
export interface RtcPayload {
  sdp?: { type: string; sdp?: string };
  candidate?: unknown;
}

/** Client → server over the websocket. */
export type ClientEvent = { type: 'rtc.signal'; to: string; payload: RtcPayload };
