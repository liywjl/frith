export type ChannelType = 'public' | 'private' | 'dm';

export const THEMES = ['ocean', 'bubbly', 'paper', 'midnight', 'forest', 'sunset', 'mono'] as const;
export type Theme = (typeof THEMES)[number];

/** A link someone put on their profile — blog, socials, photos, anywhere. */
export interface ProfileLink {
  label: string;
  url: string;
}

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
  /** A short self-description for the profile page. */
  bio: string | null;
  /** Where else to find them — everything is opt-in and public-by-choice. */
  links: ProfileLink[];
  /** Hex color that tints their profile page; null = the space's accent. */
  accentColor: string | null;
  /** Where they are — free text, shown with a pin on the profile. */
  location: string | null;
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
  /** What the space is for — set by a manager, null if unset. */
  description: string | null;
  /** URL for the space logo image, or null. Carries a cache-busting version. */
  logoUrl: string | null;
  /** Shareable invite: high-entropy key, unguessable. It's the key to the
   *  space, so only managers (owner + admins) receive it; null otherwise. */
  invite: string | null;
  connectedPeers: number;
  /** userId of the space owner (author of the first identity), if known. */
  ownerUserId: string | null;
  /** userIds the owner has made admins. */
  adminUserIds: string[];
  /** Whether the viewer (this device's user) may evict/rotate. */
  canManage: boolean;
  /** Whether the viewer is the owner (may manage admins + settings). */
  isOwner: boolean;
  /** Whether newcomers can read history sent before they joined. */
  historyVisibility: 'full' | 'join-forward';
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

/** A shared doc's listing entry — the space's living pages, synced P2P. */
export interface DocDto {
  id: string;
  title: string;
  createdBy: string;
  updatedAt: string;
  updatedByName: string;
}

/** The full doc, body included, for the editor. */
export interface DocFullDto extends DocDto {
  body: string;
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
  bio?: string | null;
  links?: ProfileLink[];
  accentColor?: string | null;
  location?: string | null;
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
  /** Byte-verified mime (see effectiveMime) — drives click-to-preview. */
  mime: string;
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
  /** True when this device lacks the content key (e.g. sent after we were
   *  removed): `body` is a placeholder, not the real text. */
  locked?: boolean;
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
  /** Images they shared in channels the viewer can read (never DMs). */
  photos: FileDto[];
}

/* ------------------------------- the feed ------------------------------ */

/** One URL shared in chat, with its display domain. No unfurling: previews
 *  would mean every reader's device pinging the linked site. */
export interface FeedLinkDto {
  url: string;
  domain: string;
}

interface FeedItemBase {
  id: string;
  at: string;
  author: UserDto;
}

/** Chat context for feed items that came from a message. */
interface FeedMessageBase extends FeedItemBase {
  channelId: string;
  channelName: string;
  messageId: string;
  /** The message text (already snippet-length; '' adds nothing to show). */
  body: string;
  /** Thread replies on the post — the feed's comments. */
  comments: number;
  /** Total reactions on the post. */
  reactions: number;
}

/**
 * One entry in the space feed. Strictly chronological, never ranked — the
 * feed is what your people shared, newest first, with a definite end.
 */
export type FeedItemDto =
  | (FeedMessageBase & { kind: 'links'; links: FeedLinkDto[] })
  | (FeedMessageBase & { kind: 'photos'; photos: AttachmentDto[] })
  | (FeedItemBase & { kind: 'doc'; docId: string; title: string })
  | (FeedItemBase & { kind: 'enjoying'; nowPlaying: string });

export interface FeedDto {
  items: FeedItemDto[];
}

/* --------------------------- community directory ----------------------- */

/** One public community broadcasting what it's about. Directory entries are
 *  external, curator-signed-later data: display + an invite the user may
 *  choose to use, nothing more. */
export interface DirectoryEntryDto {
  name: string;
  description: string;
  /** Interest tags — the "broadcast your interests publicly" half. */
  tags: string[];
  /** Member count as reported by the directory — advisory, not verified. */
  members?: number;
  /** Who runs/seeds it (a hostname or a name), for the trust read. */
  host?: string;
  /** Invite key when the community is open-join; null = ask the host. */
  invite: string | null;
}

export interface DirectoryDto {
  /** Where this list came from (a URL), or null for the bundled sample. */
  source: string | null;
  entries: DirectoryEntryDto[];
  /** Present when the configured directory couldn't be reached. */
  error?: string;
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
  /** Who is recording a channel's campfire changed — shown to everyone. */
  | { type: 'call.recording'; channelId: string; recorders: string[] }
  /** A file's bytes finished downloading to this device. */
  | { type: 'file.cached'; channelId: string; messageId: string; attachmentId: string }
  /** A shared doc changed (created, edited, or removed) — refetch. */
  | { type: 'docs.changed'; docId: string }
  /** WebRTC signaling relayed between two users. */
  | { type: 'rtc.signal'; from: string; payload: RtcPayload }
  /** Someone sketched on the shared screen — ephemeral ink, fades client-side. */
  | { type: 'call.draw'; channelId: string; from: string; seg: DrawSeg };

/** SDP offer/answer or ICE candidate, passed through the server verbatim. */
export interface RtcPayload {
  sdp?: { type: string; sdp?: string };
  candidate?: unknown;
  /** The sender's screen-share stream id (null = not sharing) — rides along
   *  with SDP so the receiver can tell the screen apart from the camera. */
  screen?: string | null;
}

/** One incremental chunk of a fading annotation stroke. Coordinates are
 *  normalized 0..1 against the shared frame, so every viewport agrees. */
export interface DrawSeg {
  id: string;
  color: string;
  points: [number, number][];
}

/** Client → server over the websocket. */
export type ClientEvent =
  | { type: 'rtc.signal'; to: string; payload: RtcPayload }
  | { type: 'call.draw'; channelId: string; seg: DrawSeg };
