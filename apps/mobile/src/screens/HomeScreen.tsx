// The Home digest + Ask — the "institutional memory" surface. Ask runs the
// same ACL-filtered retrieval as desktop, over the state this phone holds.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AskResponse, HomeDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Field, Row, SectionTitle } from '../components/ui';
import type { Nav } from '../App';

export function HomeScreen({ nav }: { nav: Nav }) {
  const { backend, hello } = useStore();
  const [home, setHome] = useState<HomeDto | null>(null);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);

  const refresh = useCallback(() => {
    backend.call<HomeDto>('home.get').then(setHome).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refresh();
    return backend.onEvent((event) => {
      if (event.type === 'message.created' || event.type === 'channels.changed') refresh();
    });
  }, [backend, refresh]);

  const runAsk = () => {
    if (!query.trim()) return setAnswer(null);
    backend.call<AskResponse>('ask', { q: query }).then(setAnswer).catch(() => {});
  };

  return (
    <ScrollView style={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Home</Text>
        <Text style={styles.hi}>
          {hello.me?.avatarEmoji ?? ''} {hello.me?.name}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <Field value={query} onChangeText={setQuery} placeholder="Ask the space… (who knows / what happened)" onSubmitEditing={runAsk} />
      </View>

      {answer && (
        <View>
          <SectionTitle>
            {answer.messages.length + answer.threads.length} matches for “{answer.query}”
          </SectionTitle>
          {answer.people.slice(0, 3).map((p) => (
            <Row key={p.user.id}>
              <Text style={styles.itemTitle}>
                {p.user.avatarEmoji ?? '·'} {p.user.name}
              </Text>
              <Text style={styles.itemMeta}>knows about this</Text>
            </Row>
          ))}
          {answer.threads.slice(0, 3).map((t) => (
            <ThreadItem
              key={t.rootId}
              nav={nav}
              channelId={t.channelId}
              rootId={t.rootId}
              title={`#${t.channelName} — ${t.rootAuthorName}`}
              body={stripMarks(t.topSnippet)}
            />
          ))}
          {answer.messages.slice(0, 5).map((m) => (
            <Row key={m.messageId} onPress={() => nav.push({ name: 'channel', channelId: m.channelId })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>#{m.channelName}</Text>
                <Text style={styles.itemBody} numberOfLines={2}>
                  {stripMarks(m.snippet)}
                </Text>
              </View>
            </Row>
          ))}
        </View>
      )}

      {home && home.unread.length > 0 && (
        <View>
          <SectionTitle>Catch up</SectionTitle>
          {home.unread.map((u) => (
            <Row key={u.channelId} onPress={() => nav.push({ name: 'channel', channelId: u.channelId })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {u.type === 'dm' ? (u.dmPartnerNames?.join(', ') ?? u.name) : `#${u.name}`} · {u.unreadCount} new
                </Text>
                <Text style={styles.itemBody} numberOfLines={1}>
                  {u.latestAuthor}: {u.latestSnippet}
                </Text>
              </View>
            </Row>
          ))}
        </View>
      )}

      {home && home.threads.length > 0 && (
        <View>
          <SectionTitle>Your threads</SectionTitle>
          {home.threads.map((t) => (
            <ThreadItem
              key={t.rootId}
              nav={nav}
              channelId={t.channelId}
              rootId={t.rootId}
              title={`#${t.channelName} · ${t.replyCount} replies`}
              body={t.rootSnippet}
            />
          ))}
        </View>
      )}

      {home && home.popular.length > 0 && (
        <View style={{ paddingBottom: 24 }}>
          <SectionTitle>Popular right now</SectionTitle>
          {home.popular.map((p) => (
            <ThreadItem
              key={p.rootId}
              nav={nav}
              channelId={p.channelId}
              rootId={p.rootId}
              title={`#${p.channelName} — ${p.authorName}`}
              body={p.snippet}
              meta={`${p.replyCount} replies · ${p.reactionCount} reactions`}
            />
          ))}
        </View>
      )}

      {home && home.unread.length === 0 && home.threads.length === 0 && home.popular.length === 0 && !answer && (
        <Text style={styles.empty}>All caught up. Ask the space something, or start a conversation.</Text>
      )}
    </ScrollView>
  );
}

/** Ask snippets mark hits with [[double brackets]]; render them plain. */
function stripMarks(s: string): string {
  return s.replaceAll('[[', '').replaceAll(']]', '');
}

/** One tappable thread in a digest list — opens the thread view. */
function ThreadItem(props: { nav: Nav; channelId: string; rootId: string; title: string; body: string; meta?: string }) {
  return (
    <Row onPress={() => props.nav.push({ name: 'thread', channelId: props.channelId, rootId: props.rootId })}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={styles.itemBody} numberOfLines={2}>
          {props.body}
        </Text>
        {props.meta ? <Text style={styles.itemMeta}>{props.meta}</Text> : null}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  hi: { color: colors.dim, fontSize: font.body },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  itemBody: { color: colors.dim, fontSize: font.small, marginTop: 2 },
  itemMeta: { color: colors.faint, fontSize: font.small, marginTop: 2 },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
});
