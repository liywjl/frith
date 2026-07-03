import { pgTable, uuid, text, timestamp, pgEnum, primaryKey, index, integer, jsonb } from 'drizzle-orm/pg-core';

export const channelType = pgEnum('channel_type', ['public', 'private', 'dm']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  title: text('title'),
  team: text('team'),
  avatarEmoji: text('avatar_emoji'),
  statusEmoji: text('status_emoji'),
  statusText: text('status_text'),
  statusExpiresAt: timestamp('status_expires_at', { withTimezone: true }),
  /** The fun side of the profile: things you choose to share. */
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  nowPlaying: text('now_playing'),
  theme: text('theme').notNull().default('paper'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: channelType('type').notNull(),
  topic: text('topic'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id').notNull().references(() => channels.id),
    userId: uuid('user_id').notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

/** Columns shared by live and scheduled messages (fresh builders per call). */
const messageColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id),
  authorId: uuid('author_id').notNull().references(() => users.id),
  parentMessageId: uuid('parent_message_id'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', messageColumns(), (t) => [
  index('messages_channel_created_idx').on(t.channelId, t.createdAt),
]);

/** The P2P space this instance belongs to (one per instance for now). */
export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  inviteKey: text('invite_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** People this user chose not to interact with. */
export const blocks = pgTable(
  'blocks',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    blockedId: uuid('blocked_id').notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.blockedId] })],
);

/** Messages written now, delivered later. */
export const scheduledMessages = pgTable('scheduled_messages', {
  ...messageColumns(),
  sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
});

/** Favourite conversations, ordered by the user. */
export const pins = pgTable(
  'pins',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    channelId: uuid('channel_id').notNull().references(() => channels.id),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

/** How far each user has read each channel — powers unread badges. */
export const channelReads = pgTable(
  'channel_reads',
  {
    channelId: uuid('channel_id').notNull().references(() => channels.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

export const reactions = pgTable(
  'reactions',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    emoji: text('emoji').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);
