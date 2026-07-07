// Everyone in the space. Tap for the profile card (stats, interests), start a
// DM, or block. Same data the desktop profile page shows, ACL-filtered.
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ProfilePageDto, UserDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Avatar, Button, ErrorNote, Row } from '../components/ui';
import type { Nav } from '../App';

export function PeopleScreen({ nav }: { nav: Nav }) {
  const { backend, hello, refreshHello } = useStore();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [selected, setSelected] = useState<UserDto | null>(null);
  const [profile, setProfile] = useState<ProfilePageDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    backend.call<UserDto[]>('users.list').then(setUsers).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refresh();
    return backend.onEvent((event) => {
      if (event.type === 'user.updated') refresh();
    });
  }, [backend, refresh]);

  const open = (user: UserDto) => {
    setSelected(user);
    setProfile(null);
    setError(null);
    backend.call<ProfilePageDto>('users.profile', { userId: user.id }).then(setProfile).catch(() => {});
  };

  const openDm = (userId: string) => {
    backend
      .call<{ channelId: string }>('dms.open', { userId })
      .then(({ channelId }) => {
        setSelected(null);
        nav.push({ name: 'channel', channelId });
      })
      .catch((err: Error) => setError(err.message));
  };

  const blocked = (id: string) => hello.me?.blockedUserIds.includes(id) ?? false;
  const toggleBlock = (id: string) => {
    backend
      .call('users.block', { userId: id, on: !blocked(id) })
      .then(() => refreshHello())
      .catch((err: Error) => setError(err.message));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>People</Text>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => (
          <Row onPress={() => open(item)}>
            <Avatar emoji={item.avatarEmoji} name={item.name} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {item.name}
                {item.id === hello.me?.id ? '  (you)' : ''}
                {blocked(item.id) ? '  · blocked' : ''}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                @{item.handle}
                {item.title ? ` · ${item.title}` : ''}
                {item.statusEmoji ? `   ${item.statusEmoji} ${item.statusText ?? ''}` : ''}
              </Text>
            </View>
          </Row>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Nobody here yet — share the invite from the Space tab.</Text>}
      />

      <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            {selected && (
              <ScrollView>
                <View style={styles.sheetHead}>
                  <Avatar emoji={selected.avatarEmoji} name={selected.name} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetName}>{selected.name}</Text>
                    <Text style={styles.meta}>
                      @{selected.handle}
                      {selected.title ? ` · ${selected.title}` : ''}
                      {selected.team ? ` · ${selected.team}` : ''}
                    </Text>
                  </View>
                </View>
                {selected.statusText || selected.statusEmoji ? (
                  <Text style={styles.status}>
                    {selected.statusEmoji ?? ''} {selected.statusText ?? ''}
                  </Text>
                ) : null}
                {selected.interests.length > 0 && <Text style={styles.interests}>{selected.interests.join(' · ')}</Text>}
                {selected.nowPlaying ? <Text style={styles.meta}>♫ {selected.nowPlaying}</Text> : null}
                {profile && (
                  <Text style={styles.stats}>
                    {profile.stats.messages} messages · {profile.stats.reactionsReceived} reactions ·{' '}
                    {profile.stats.channelsActive} active channels
                  </Text>
                )}
                <ErrorNote message={error} />
                {selected.id !== hello.me?.id && (
                  <View style={styles.actions}>
                    <Button label="Message" onPress={() => openDm(selected.id)} />
                    <Button
                      label={blocked(selected.id) ? 'Unblock' : 'Block'}
                      kind="danger"
                      onPress={() => toggleBlock(selected.id)}
                    />
                  </View>
                )}
                <Button label="Close" kind="ghost" onPress={() => setSelected(null)} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800', paddingHorizontal: 16, paddingVertical: 12 },
  name: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  meta: { color: colors.dim, fontSize: font.small, marginTop: 1 },
  empty: { color: colors.dim, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    maxHeight: '75%',
    gap: 10,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  sheetName: { color: colors.text, fontSize: font.header, fontWeight: '700' },
  status: { color: colors.text, fontSize: font.body, marginVertical: 4 },
  interests: { color: colors.accent, fontSize: font.small, marginVertical: 4 },
  stats: { color: colors.dim, fontSize: font.small, marginVertical: 8 },
  actions: { flexDirection: 'row', gap: 10, marginVertical: 12, justifyContent: 'space-between' },
});
