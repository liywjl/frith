// A channel (or a thread inside one): live messages, composer, reactions,
// attachments. Realtime comes from the worklet's op fan-out — the same events
// the desktop websocket carries.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MessageDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Avatar, ErrorNote, Loading } from '../components/ui';
import type { Nav } from '../App';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

export function ChannelScreen(props: { channelId: string; threadRootId?: string; nav: Nav }) {
  const { channelId, threadRootId, nav } = props;
  const { backend, channels } = useStore();
  const channel = channels.find((c) => c.id === channelId);
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [draft, setDraft] = useState('');
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<MessageDto>>(null);

  const refresh = useCallback(() => {
    const load: Promise<MessageDto[]> = threadRootId
      ? backend.call<MessageDto[]>('messages.thread', { rootId: threadRootId })
      : backend.call<MessageDto[]>('messages.list', { channelId });
    load.then(setMessages).catch((err: Error) => setError(err.message));
  }, [backend, channelId, threadRootId]);

  useEffect(() => {
    refresh();
    void backend.call('channels.read', { id: channelId }).catch(() => {});
    return backend.onEvent((event) => {
      if (event.type === 'message.created' && event.message.channelId === channelId) {
        refresh(); // reply counts + threads shift too — refetch is the simple truth
        void backend.call('channels.read', { id: channelId }).catch(() => {});
      }
      if ((event.type === 'reaction.changed' || event.type === 'file.cached') && event.channelId === channelId) refresh();
    });
  }, [backend, channelId, refresh]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    backend
      .call('messages.send', { channelId, body, parentMessageId: threadRootId })
      .then(refresh)
      .catch((err: Error) => setError(err.message));
  };

  const react = (messageId: string, emoji: string) => {
    setReactingTo(null);
    backend
      .call('messages.react', { messageId, emoji })
      .then(refresh)
      .catch((err: Error) => setError(err.message));
  };

  const title = threadRootId
    ? 'Thread'
    : channel
      ? channel.type === 'dm'
        ? (channel.dmPartnerNames?.join(', ') ?? 'Conversation')
        : `${channel.type === 'private' ? '🔒 ' : '#'}${channel.name}`
      : 'Channel';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={nav.pop} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!threadRootId && channel?.topic ? (
            <Text style={styles.topic} numberOfLines={1}>
              {channel.topic}
            </Text>
          ) : null}
        </View>
      </View>

      {!messages ? (
        <Loading />
      ) : (
        <FlatList
          ref={listRef}
          data={[...messages].reverse()}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              inThread={threadRootId !== undefined}
              onOpenThread={() => nav.push({ name: 'thread', channelId, rootId: item.parentMessageId ?? item.id })}
              onToggleReactions={() => setReactingTo((v) => (v === item.id ? null : item.id))}
              showReactionBar={reactingTo === item.id}
              onReact={(emoji) => react(item.id, emoji)}
              onFetchFile={(attachmentId) =>
                void backend.call('files.get', { id: attachmentId, wait: true }).then(refresh, () => {})
              }
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {channel?.archivedAt ? 'This channel is archived.' : 'No messages yet — say the first thing.'}
            </Text>
          }
        />
      )}

      <ErrorNote message={error} />
      {!channel?.archivedAt && (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={threadRootId ? 'Reply in thread…' : `Message ${title}`}
            placeholderTextColor={colors.faint}
            multiline
            style={styles.input}
          />
          <Pressable onPress={send} style={[styles.send, !draft.trim() && { opacity: 0.4 }]} disabled={!draft.trim()}>
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>↑</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function MessageRow(props: {
  message: MessageDto;
  inThread: boolean;
  onOpenThread: () => void;
  onToggleReactions: () => void;
  showReactionBar: boolean;
  onReact: (emoji: string) => void;
  onFetchFile: (attachmentId: string) => void;
}) {
  const { message } = props;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <Pressable onLongPress={props.onToggleReactions} onPress={!props.inThread ? props.onOpenThread : undefined}>
      <View style={styles.message}>
        <Avatar emoji={message.authorAvatarEmoji} name={message.authorName} size={34} />
        <View style={{ flex: 1 }}>
          <View style={styles.messageHead}>
            <Text style={styles.author}>{message.authorName}</Text>
            <Text style={styles.time}>{time}</Text>
          </View>
          {message.body ? (
            <Text style={[styles.body, message.locked && styles.locked]}>
              {message.locked ? '🔒 ' : ''}
              {message.body}
            </Text>
          ) : null}
          {message.attachments.map((a) => (
            <AttachmentView key={a.id} attachment={a} onFetch={() => props.onFetchFile(a.id)} />
          ))}
          <View style={styles.metaRow}>
            {message.reactions.map((r) => (
              <Pressable key={r.emoji} onPress={() => props.onReact(r.emoji)} style={[styles.reaction, r.mine && styles.reactionMine]}>
                <Text style={{ fontSize: font.small }}>
                  {r.emoji} {r.count}
                </Text>
              </Pressable>
            ))}
            {!props.inThread && message.replyCount > 0 && (
              <Pressable onPress={props.onOpenThread}>
                <Text style={styles.replies}>
                  {message.replyCount} repl{message.replyCount === 1 ? 'y' : 'ies'} ›
                </Text>
              </Pressable>
            )}
          </View>
          {props.showReactionBar && (
            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable key={emoji} onPress={() => props.onReact(emoji)} hitSlop={6}>
                  <Text style={{ fontSize: 22 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function AttachmentView(props: { attachment: MessageDto['attachments'][number]; onFetch: () => void }) {
  const { backend } = useStore();
  const a = props.attachment;
  const [dataUri, setDataUri] = useState<string | null>(null);

  useEffect(() => {
    // Images render inline once their bytes are on this device (auto-fetch
    // policy or an explicit tap); everything else stays a chip.
    if (a.kind === 'image' && a.cached && !a.dangerous) {
      backend
        .call<{ base64: string | null; mime: string }>('files.get', { id: a.id })
        .then((f) => f.base64 && setDataUri(`data:${f.mime};base64,${f.base64}`))
        .catch(() => {});
    }
  }, [backend, a.id, a.kind, a.cached, a.dangerous]);

  if (dataUri) return <Image source={{ uri: dataUri }} style={styles.image} resizeMode="cover" />;
  const size = a.size > 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`;
  return (
    <Pressable onPress={a.cached ? undefined : props.onFetch} style={styles.file}>
      <Text style={{ fontSize: 18 }}>{a.dangerous ? '⚠️' : '📄'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.fileName} numberOfLines={1}>
          {a.name}
        </Text>
        <Text style={styles.fileMeta}>
          {size}
          {a.cached ? ' · on this device' : ' · tap to fetch from a peer'}
          {a.dangerous ? ' · could execute if opened' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.accent, fontSize: 32, marginTop: -4 },
  title: { color: colors.text, fontSize: font.header, fontWeight: '700' },
  topic: { color: colors.faint, fontSize: font.small },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 48, transform: [{ scaleY: -1 }] },
  message: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  messageHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  author: { color: colors.text, fontWeight: '700', fontSize: font.body },
  time: { color: colors.faint, fontSize: font.small },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21, marginTop: 1 },
  locked: { color: colors.dim, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  reaction: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionMine: { borderWidth: 1, borderColor: colors.accent },
  replies: { color: colors.accent, fontSize: font.small, fontWeight: '600' },
  reactionBar: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  image: { width: 220, height: 160, borderRadius: 10, marginTop: 6, backgroundColor: colors.surfaceRaised },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
  },
  fileName: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  fileMeta: { color: colors.faint, fontSize: font.small },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.body,
    backgroundColor: colors.bg,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxHeight: 120,
  },
  send: {
    backgroundColor: colors.accent,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
