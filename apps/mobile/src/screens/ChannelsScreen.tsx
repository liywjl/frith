// Channels + conversations, one list like the desktop sidebar: favourites,
// channels, DMs — unread badges throughout, archived tucked at the bottom.
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import type { ChannelDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Avatar, Badge, Button, ErrorNote, Field, Row, SectionTitle } from '../components/ui';
import type { Nav } from '../App';

export function ChannelsScreen({ nav }: { nav: Nav }) {
  const { backend, channels, refreshChannels } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => {
    const live = channels.filter((c) => !c.archivedAt);
    const pinned = live.filter((c) => c.pinned !== null).sort((a, b) => a.pinned! - b.pinned!);
    const rest = live.filter((c) => c.pinned === null);
    const list = [
      { title: 'Favourites', data: pinned },
      { title: 'Channels', data: rest.filter((c) => c.type !== 'dm') },
      { title: 'Conversations', data: rest.filter((c) => c.type === 'dm') },
      { title: 'Archived', data: channels.filter((c) => c.archivedAt) },
    ];
    return list.filter((s) => s.data.length > 0);
  }, [channels]);

  const create = () => {
    setError(null);
    backend
      .call('channels.create', { name, type: isPrivate ? 'private' : 'public' })
      .then(() => {
        setCreating(false);
        setName('');
        return refreshChannels();
      })
      .catch((err: Error) => setError(err.message));
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Channels</Text>
        <Button small kind="ghost" label={creating ? 'Cancel' : '+ New'} onPress={() => setCreating((v) => !v)} />
      </View>
      {creating && (
        <View style={styles.create}>
          <Field value={name} onChangeText={setName} placeholder="channel-name" autoFocus onSubmitEditing={create} />
          <View style={styles.createRow}>
            <Text style={{ color: colors.dim }}>Private (invite-only, own content key)</Text>
            <Switch value={isPrivate} onValueChange={setIsPrivate} />
          </View>
          <Button label="Create channel" onPress={create} disabled={!name.trim()} />
          <ErrorNote message={error} />
        </View>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
        renderItem={({ item }) => <ChannelRow channel={item} onPress={() => nav.push({ name: 'channel', channelId: item.id })} />}
        ListEmptyComponent={<Text style={styles.empty}>No channels yet — create the first one.</Text>}
      />
    </View>
  );
}

function ChannelRow({ channel, onPress }: { channel: ChannelDto; onPress: () => void }) {
  const label = channel.type === 'dm' ? (channel.dmPartnerNames?.join(', ') ?? 'Conversation') : channel.name;
  const glyph = channel.type === 'dm' ? '@' : channel.type === 'private' ? '🔒' : '#';
  return (
    <Row onPress={onPress}>
      <Avatar emoji={glyph} name={label} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, channel.unreadCount > 0 && { fontWeight: '700', color: colors.text }]} numberOfLines={1}>
          {label}
          {channel.archivedAt ? '  (archived)' : ''}
        </Text>
        {channel.topic ? (
          <Text style={styles.topic} numberOfLines={1}>
            {channel.topic}
          </Text>
        ) : null}
      </View>
      <Badge count={channel.unreadCount} />
    </Row>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  create: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: colors.text, fontSize: font.body },
  topic: { color: colors.faint, fontSize: font.small },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 48 },
});
