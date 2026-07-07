// First run: this device is nobody yet. Same posture as desktop production —
// the device becomes a user by creating a profile (new root identity) or
// importing an identity code from another device. Joining someone else's
// space via invite happens here too.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { UserDto } from '@app/shared';
import { useStore } from '../lib/store';
import { colors, font } from '../theme';
import { Avatar, Button, ErrorNote, Field, Row, SectionTitle } from '../components/ui';
import type { HelloDto } from '../../common/protocol';

type Mode = 'menu' | 'profile' | 'import' | 'join' | 'create';

export function Onboarding() {
  const { backend, hello, refreshHello } = useStore();
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [emoji, setEmoji] = useState('');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [devUsers, setDevUsers] = useState<UserDto[]>([]);

  // Seeded/dev builds: pick a user, no passwords locally — same as desktop.
  useEffect(() => {
    if (hello.dev) {
      backend.call<UserDto[]>('users.list').then(setDevUsers).catch(() => {});
    }
  }, [backend, hello.dev, hello.spaces.active]);

  const run = (task: () => Promise<HelloDto>) => {
    setBusy(true);
    setError(null);
    task()
      .then((next) => refreshHello(next))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.logo}>Frith</Text>
      <Text style={styles.space}>
        {hello.space.name} · {hello.space.connectedPeers} peer{hello.space.connectedPeers === 1 ? '' : 's'} connected
      </Text>
      <Text style={styles.tagline}>Your team's memory, on your devices. This phone isn't anyone yet.</Text>

      {mode === 'menu' && hello.dev && devUsers.length > 0 && (
        <View style={styles.devPicker}>
          <SectionTitle>Log in as (dev — seeded)</SectionTitle>
          {devUsers.map((u) => (
            <Row key={u.id} onPress={() => run(() => backend.call<HelloDto>('dev.login', { handle: u.handle }))}>
              <Avatar emoji={u.avatarEmoji} name={u.name} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.devName}>{u.name}</Text>
                <Text style={styles.devMeta}>
                  @{u.handle}
                  {u.title ? ` · ${u.title}` : ''}
                </Text>
              </View>
            </Row>
          ))}
        </View>
      )}

      {mode === 'menu' && (
        <View style={styles.stack}>
          <Button label="Create my profile in this space" onPress={() => setMode('profile')} />
          <Button label="I have an identity code" kind="ghost" onPress={() => setMode('import')} />
          <Button label="Join a different space (invite)" kind="ghost" onPress={() => setMode('join')} />
          <Button label="Start a new space" kind="ghost" onPress={() => setMode('create')} />
        </View>
      )}

      {mode === 'profile' && (
        <View style={styles.stack}>
          <Field value={name} onChangeText={setName} placeholder="Your name" autoFocus />
          <Field value={handle} onChangeText={setHandle} placeholder="handle (letters, numbers, dashes)" />
          <Field value={emoji} onChangeText={setEmoji} placeholder="avatar emoji (optional)" />
          <Button
            label={busy ? 'Creating…' : 'Create profile'}
            disabled={busy || !name.trim() || !handle.trim()}
            onPress={() =>
              run(() =>
                backend.call<HelloDto>('profiles.create', {
                  name,
                  handle,
                  avatarEmoji: emoji.trim() || null,
                }),
              )
            }
          />
          <Button label="Back" kind="ghost" onPress={() => setMode('menu')} />
        </View>
      )}

      {mode === 'import' && (
        <View style={styles.stack}>
          <Text style={styles.hint}>
            On your other device: Space → Identity → export, then paste the frith-id code here. This phone becomes one of
            your certified devices.
          </Text>
          <Field value={code} onChangeText={setCode} placeholder="frith-id:…" autoFocus />
          <Button
            label={busy ? 'Linking…' : 'Link this device'}
            disabled={busy || !code.trim()}
            onPress={() => run(() => backend.call<HelloDto>('identity.import', { code }))}
          />
          <Button label="Back" kind="ghost" onPress={() => setMode('menu')} />
        </View>
      )}

      {mode === 'join' && (
        <View style={styles.stack}>
          <Text style={styles.hint}>
            Paste a 🛰 invite. Pairing needs a member instance online; the whole space then syncs peer-to-peer.
          </Text>
          <Field value={invite} onChangeText={setInvite} placeholder="frith:name:…" autoFocus />
          <Button
            label={busy ? 'Pairing… (this can take a minute)' : 'Join space'}
            disabled={busy || !invite.trim()}
            onPress={() => run(() => backend.call<HelloDto>('space.join', { invite }))}
          />
          <Button label="Back" kind="ghost" onPress={() => setMode('menu')} />
        </View>
      )}

      {mode === 'create' && (
        <View style={styles.stack}>
          <Field value={spaceName} onChangeText={setSpaceName} placeholder="Space name" autoFocus />
          <Button
            label={busy ? 'Creating…' : 'Create space'}
            disabled={busy || !spaceName.trim()}
            onPress={() => run(() => backend.call<HelloDto>('space.create', { name: spaceName }))}
          />
          <Button label="Back" kind="ghost" onPress={() => setMode('menu')} />
        </View>
      )}

      <ErrorNote message={error} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 24, paddingTop: 64, gap: 8 },
  logo: { color: colors.text, fontSize: 40, fontWeight: '800' },
  space: { color: colors.accent, fontSize: font.body, marginBottom: 4 },
  tagline: { color: colors.dim, fontSize: font.body, marginBottom: 24 },
  stack: { gap: 10 },
  hint: { color: colors.dim, fontSize: font.small, lineHeight: 18 },
  devPicker: { marginHorizontal: -16, marginBottom: 16 },
  devName: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  devMeta: { color: colors.dim, fontSize: font.small },
});
