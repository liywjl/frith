// The space itself: invite (managers only — it IS the key), peers, membership
// management, device identity, storage policies, and hopping between the
// spaces on this device. Mirrors the desktop's space settings surface.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { UserDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Button, ErrorNote, Field, Row, SectionTitle } from '../components/ui';
import type { HelloDto } from '../../common/protocol';

interface StorageInfo {
  policies: { maxUploadMB: number; autoFetchMB: number; autoFetchRecentDays: number; storageBudgetMB: number };
  usage: { cachedBytes: number; cachedCount: number };
}

export function SpaceScreen() {
  const { backend, hello, refreshHello, peers } = useStore();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [joinInvite, setJoinInvite] = useState('');
  const [newSpace, setNewSpace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const space = hello.space;

  const refresh = useCallback(() => {
    backend.call<UserDto[]>('users.list').then(setUsers).catch(() => {});
    backend.call<StorageInfo>('storage.get').then(setStorage).catch(() => {});
  }, [backend]);

  useEffect(refresh, [refresh]);

  const act = (task: Promise<unknown>, then?: () => void) => {
    setError(null);
    task
      .then(() => refreshHello())
      .then(() => {
        refresh();
        then?.();
      })
      .catch((err: Error) => setError(err.message));
  };

  const switchTo = (dir: string) => act(backend.call<HelloDto>('spaces.switch', { dir }).then((h) => refreshHello(h)));

  return (
    <ScrollView style={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>{space.name}</Text>
        <Text style={styles.meta}>
          {peers} peer{peers === 1 ? '' : 's'} connected · history: {space.historyVisibility}
        </Text>
        {space.description ? <Text style={styles.description}>{space.description}</Text> : null}
      </View>
      <ErrorNote message={error} />

      {space.invite && (
        <View style={styles.block}>
          <SectionTitle>Invite</SectionTitle>
          <Text style={styles.hint}>
            The invite is the key to the space — share it only with people you're bringing in. A member instance must be
            online to admit them.
          </Text>
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <Button label="Share invite" onPress={() => void Share.share({ message: space.invite! })} />
          </View>
        </View>
      )}

      <SectionTitle>Members</SectionTitle>
      {users.map((u) => (
        <Row key={u.id}>
          <Text style={{ fontSize: 20 }}>{u.avatarEmoji ?? '·'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowText}>
              {u.name}
              {u.id === space.ownerUserId ? ' · owner' : space.adminUserIds.includes(u.id) ? ' · admin' : ''}
            </Text>
          </View>
          {space.isOwner && u.id !== space.ownerUserId && (
            <Button
              small
              kind="ghost"
              label={space.adminUserIds.includes(u.id) ? 'Demote' : 'Make admin'}
              onPress={() => act(backend.call('space.admin', { userId: u.id, admin: !space.adminUserIds.includes(u.id) }))}
            />
          )}
          {space.canManage && u.id !== space.ownerUserId && u.id !== hello.me?.id && (
            <Button small kind="danger" label="Remove" onPress={() => act(backend.call('space.evict', { userId: u.id }))} />
          )}
        </Row>
      ))}

      {hello.dev && (
        <>
          <SectionTitle>Dev</SectionTitle>
          <View style={styles.blockPad}>
            <Button
              label={`Switch user (now ${hello.me?.name ?? 'nobody'})`}
              kind="ghost"
              onPress={() => act(backend.call<HelloDto>('dev.logout').then((h) => refreshHello(h)))}
            />
          </View>
        </>
      )}

      <SectionTitle>Identity</SectionTitle>
      <Text style={styles.hint}>
        Your identity is a root key on this device. Export it to sign in as yourself on another device — treat the code
        like a password.
      </Text>
      <View style={styles.blockPad}>
        {identity ? (
          <>
            <Text selectable style={styles.code}>
              {identity}
            </Text>
            <Button label="Share code" kind="ghost" onPress={() => void Share.share({ message: identity })} />
            <Button label="Hide" kind="ghost" onPress={() => setIdentity(null)} />
          </>
        ) : (
          <Button
            label="Export identity code"
            kind="ghost"
            onPress={() =>
              backend
                .call<{ code: string }>('identity.export')
                .then(({ code }) => setIdentity(code))
                .catch((err: Error) => setError(err.message))
            }
          />
        )}
      </View>

      {storage && (
        <>
          <SectionTitle>Storage on this phone</SectionTitle>
          <Text style={styles.hint}>
            What this device stores is your call, never the space's: auto-download files ≤ {storage.policies.autoFetchMB} MB,
            keep at most {storage.policies.storageBudgetMB} MB of other people's files (oldest evict first). Currently
            caching {storage.usage.cachedCount} files · {(storage.usage.cachedBytes / 1024 / 1024).toFixed(1)} MB.
          </Text>
          <View style={styles.blockPad}>
            <Button
              label="Clear cached files"
              kind="ghost"
              onPress={() => act(backend.call('storage.clearCache'))}
            />
          </View>
        </>
      )}

      <SectionTitle>Spaces on this device</SectionTitle>
      {hello.spaces.spaces.map((s) => (
        <Row key={s.dir} onPress={s.dir === hello.spaces.active ? undefined : () => switchTo(s.dir)}>
          <Text style={styles.rowText}>
            {s.name}
            {s.dir === hello.spaces.active ? '  ✓ open' : ''}
          </Text>
        </Row>
      ))}
      <View style={[styles.blockPad, { gap: 10 }]}>
        <Field value={joinInvite} onChangeText={setJoinInvite} placeholder="Join with an invite: frith:…" />
        <Button
          label="Join space"
          kind="ghost"
          disabled={!joinInvite.trim()}
          onPress={() =>
            act(
              backend.call<HelloDto>('space.join', { invite: joinInvite }).then((h) => refreshHello(h)),
              () => setJoinInvite(''),
            )
          }
        />
        <Field value={newSpace} onChangeText={setNewSpace} placeholder="Start a new space: name" />
        <Button
          label="Create space"
          kind="ghost"
          disabled={!newSpace.trim()}
          onPress={() =>
            act(
              backend.call<HelloDto>('space.create', { name: newSpace }).then((h) => refreshHello(h)),
              () => setNewSpace(''),
            )
          }
        />
      </View>
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  meta: { color: colors.dim, fontSize: font.small, marginTop: 2 },
  description: { color: colors.dim, fontSize: font.body, marginTop: 6 },
  block: { marginBottom: 4 },
  blockPad: { paddingHorizontal: 16, gap: 8, marginTop: 8 },
  hint: { color: colors.faint, fontSize: font.small, lineHeight: 18, paddingHorizontal: 16 },
  rowText: { color: colors.text, fontSize: font.body },
  code: { color: colors.ok, fontSize: font.small, fontFamily: 'Courier', backgroundColor: colors.surface, padding: 10, borderRadius: 8 },
});
