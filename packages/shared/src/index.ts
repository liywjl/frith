export type ChannelType = 'public' | 'private' | 'dm';

export interface UserDto {
  id: string;
  handle: string;
  name: string;
}

export interface ChannelDto {
  id: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  /** For DMs: the other participants' names, used as the display label. */
  dmPartnerNames?: string[];
}

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  parentMessageId: string | null;
  body: string;
  createdAt: string;
  replyCount: number;
}

/** Server → client realtime events. */
export type ServerEvent = { type: 'message.created'; message: MessageDto };
