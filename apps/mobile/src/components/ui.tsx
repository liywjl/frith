// Small shared pieces: buttons, inputs, list rows, section headers, avatars.
import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, font } from '../theme';

export function Button(props: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
}) {
  const kind = props.kind ?? 'primary';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.button,
        props.small && styles.buttonSmall,
        kind === 'primary' && { backgroundColor: colors.accent },
        kind === 'ghost' && { backgroundColor: colors.surfaceRaised },
        kind === 'danger' && { backgroundColor: '#3d1f2b' },
        (pressed || props.disabled) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          props.small && { fontSize: font.small },
          kind === 'primary' && { color: colors.accentText },
          kind === 'ghost' && { color: colors.text },
          kind === 'danger' && { color: colors.danger },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Field(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  multiline?: boolean;
  style?: StyleProp<TextStyle>;
  onSubmitEditing?: () => void;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.faint}
      autoFocus={props.autoFocus}
      multiline={props.multiline}
      autoCapitalize="none"
      onSubmitEditing={props.onSubmitEditing}
      style={[styles.field, props.style]}
    />
  );
}

export function SectionTitle(props: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{props.children}</Text>;
}

export function Row(props: { onPress?: () => void; onLongPress?: () => void; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => [styles.row, pressed && props.onPress && { backgroundColor: colors.surfaceRaised }, props.style]}
    >
      {props.children}
    </Pressable>
  );
}

export function Avatar(props: { emoji: string | null; name: string; size?: number }) {
  const size = props.size ?? 36;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 3 }]}>
      <Text style={{ fontSize: size * 0.55 }}>{props.emoji ?? props.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function Badge(props: { count: number }) {
  if (props.count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{props.count > 99 ? '99+' : props.count}</Text>
    </View>
  );
}

export function Loading(props: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
      {props.label ? <Text style={{ color: colors.dim, marginTop: 12 }}>{props.label}</Text> : null}
    </View>
  );
}

export function ErrorNote(props: { message: string | null }) {
  if (!props.message) return null;
  return <Text style={styles.error}>{props.message}</Text>;
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonSmall: { paddingVertical: 7, paddingHorizontal: 12 },
  buttonLabel: { fontSize: font.body, fontWeight: '600' },
  field: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: font.body,
  },
  sectionTitle: {
    color: colors.dim,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: colors.unread,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  badgeText: { color: colors.accentText, fontSize: font.small, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  error: { color: colors.danger, paddingHorizontal: 16, paddingVertical: 8 },
});
