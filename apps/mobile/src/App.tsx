// Frith on a phone: the same premise as the desktop app — your P2P node as an
// app — with the server running in a Bare worklet instead of an Electron
// utility process. Navigation is a tiny hand-rolled stack over four tabs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Backend, isSeeded } from './lib/backend';
import { StoreProvider, useStore } from './lib/store';
import { colors, font } from './theme';
import { Loading } from './components/ui';
import type { HelloDto } from '../common/protocol';
import { Onboarding } from './screens/Onboarding';
import { HomeScreen } from './screens/HomeScreen';
import { ChannelsScreen } from './screens/ChannelsScreen';
import { ChannelScreen } from './screens/ChannelScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { SpaceScreen } from './screens/SpaceScreen';

export type Route =
  | { name: 'channel'; channelId: string }
  | { name: 'thread'; channelId: string; rootId: string };

export interface Nav {
  push: (route: Route) => void;
  pop: () => void;
}

const TABS = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'channels', label: 'Channels', icon: '#' },
  { key: 'people', label: 'People', icon: '☺' },
  { key: 'space', label: 'Space', icon: '☍' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const backendRef = useRef<Backend | null>(null);
  const [hello, setHello] = useState<HelloDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const backend = new Backend();
    backendRef.current = backend;
    backend
      .start()
      .then(setHello)
      .catch((err: Error) => setError(err.message));
    // Suspend the worklet in the background (Bare's lifecycle model) so the
    // P2P node isn't burning radio and battery while the app is invisible.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') backend.resume();
      else if (state === 'background') backend.suspend();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {error ? (
          <View style={styles.boot}>
            <Text style={styles.bootTitle}>Frith could not start</Text>
            <Text style={styles.bootError}>{error}</Text>
            <Text style={styles.bootHint}>
              The P2P backend runs in a native Bare worklet — build a dev client (npx expo run:ios / run:android); Expo Go
              cannot load it.
            </Text>
          </View>
        ) : !hello ? (
          <Loading label={isSeeded() ? 'seeding the demo spaces… (fresh every launch)' : 'opening your space…'} />
        ) : (
          <StoreProvider backend={backendRef.current!} initial={hello}>
            <Shell />
          </StoreProvider>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { hello } = useStore();
  const [tab, setTab] = useState<TabKey>('home');
  const [stack, setStack] = useState<Route[]>([]);

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const nav: Nav = { push, pop };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length === 0) return false;
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  if (!hello.me) return <Onboarding />;

  const top = stack[stack.length - 1];
  if (top?.name === 'channel') return <ChannelScreen channelId={top.channelId} nav={nav} />;
  if (top?.name === 'thread') return <ChannelScreen channelId={top.channelId} threadRootId={top.rootId} nav={nav} />;

  return (
    <View style={styles.root}>
      <View style={styles.tabBody}>
        {tab === 'home' && <HomeScreen nav={nav} />}
        {tab === 'channels' && <ChannelsScreen nav={nav} />}
        {tab === 'people' && <PeopleScreen nav={nav} />}
        {tab === 'space' && <SpaceScreen />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tabButton} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabIcon, tab === t.key && { color: colors.accent }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.key && { color: colors.accent }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  bootTitle: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  bootError: { color: colors.danger, fontSize: font.body, textAlign: 'center' },
  bootHint: { color: colors.dim, fontSize: font.small, textAlign: 'center' },
  tabBody: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  tabIcon: { color: colors.dim, fontSize: 20 },
  tabLabel: { color: colors.dim, fontSize: font.small },
});
