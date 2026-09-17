import React from 'react';
import {
  ActivityIndicator, Pressable, Text, TextInput, View, StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import { theme, scoreColor } from '../theme';

export function Button({
  title, onPress, loading, disabled, variant = 'primary', style,
}: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' | 'danger'; style?: ViewStyle }) {
  const bg = variant === 'primary' ? theme.colors.primary : variant === 'danger' ? theme.colors.danger : 'transparent';
  const border = variant === 'ghost' ? theme.colors.border : 'transparent';
  const color = variant === 'ghost' ? theme.colors.text : theme.colors.primaryText;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === 'ghost' ? 1 : 0, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.btnText, { color }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}
export function P({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: TextStyle }) {
  return <Text style={[styles.p, dim && { color: theme.colors.textDim }, style]}>{children}</Text>;
}

export function Field({
  label, value, onChangeText, placeholder, secureTextEntry, multiline, minHeight, autoCapitalize,
}: any) {
  return (
    <View style={{ marginBottom: theme.space(2) }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textDim}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={autoCapitalize || 'none'}
        style={[styles.input, multiline && { minHeight: minHeight || 120, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function ChipRow({ items }: { items: string[] }) {
  return (
    <View style={styles.chipRow}>
      {items.map((it, i) => (
        <Chip key={`${it}-${i}`} label={it} />
      ))}
    </View>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <View style={[styles.badge, { borderColor: scoreColor(score) }]}>
      <Text style={[styles.badgeText, { color: scoreColor(score) }]}>{score}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.primary} size="large" />
      {label ? <Text style={[styles.p, { marginTop: theme.space(2), color: theme.colors.textDim }]}>{label}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ error, onRetry }: { error: any; onRetry?: () => void }) {
  if (!error) return null;
  const rateLimited = error?.isRateLimited;
  return (
    <View style={[styles.banner, { borderColor: rateLimited ? theme.colors.warn : theme.colors.danger }]}>
      <Text style={{ color: theme.colors.text, marginBottom: onRetry ? theme.space(1) : 0 }}>
        {rateLimited ? '⏳ Rate limited by the model provider. This is expected on free tiers.' : `⚠️ ${error.message || 'Something went wrong.'}`}
      </Text>
      {onRetry ? <Button title={rateLimited ? 'Try again' : 'Retry'} variant="ghost" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: theme.radius, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: theme.colors.card, borderRadius: theme.radius, padding: theme.space(2), borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.space(2) },
  h1: { color: theme.colors.text, fontSize: 26, fontWeight: '700', marginBottom: theme.space(1) },
  h2: { color: theme.colors.text, fontSize: 18, fontWeight: '700', marginBottom: theme.space(1) },
  p: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  label: { color: theme.colors.textDim, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: theme.colors.cardAlt, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 14, fontSize: 15 },
  chip: { backgroundColor: theme.colors.chip, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  chipText: { color: theme.colors.text, fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  badge: { minWidth: 46, height: 46, borderRadius: 23, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 18, fontWeight: '800' },
  loading: { alignItems: 'center', justifyContent: 'center', padding: theme.space(4) },
  banner: { borderWidth: 1, borderRadius: theme.radius, padding: theme.space(2), marginBottom: theme.space(2), backgroundColor: theme.colors.cardAlt },
});
