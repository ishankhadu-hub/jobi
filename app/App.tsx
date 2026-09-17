import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View, Pressable } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { theme } from './src/theme';
import { Loading } from './src/components/ui';
import { NavContext, NavCtx, Route } from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import InterviewScreen from './src/screens/InterviewScreen';
import PlanScreen from './src/screens/PlanScreen';
import PaywallScreen from './src/screens/PaywallScreen';

// ── tiny navigation: a stack in state; no nav library to drift out of sync ──
// (NavContext lives in ./src/navigation to avoid an App<->screens import cycle.)
const SCREENS: Record<string, React.ComponentType<any>> = {
  home: HomeScreen,
  results: ResultsScreen,
  interview: InterviewScreen,
  plan: PlanScreen,
  paywall: PaywallScreen,
};

function Shell() {
  const { ready, user, subscription, signOut } = useAuth();
  const [stack, setStack] = useState<Route[]>([{ screen: 'home' }]);
  const nav = useMemo<NavCtx>(
    () => ({
      route: stack[stack.length - 1],
      go: (screen, params) => setStack((s) => [...s, { screen, params }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      reset: (screen, params) => setStack([{ screen, params }]),
    }),
    [stack]
  );

  if (!ready) return <View style={styles.center}><Loading label="Loading…" /></View>;
  if (!user) return <AuthScreen />;

  const Current = SCREENS[nav.route.screen] || HomeScreen;
  const canBack = stack.length > 1;
  const planLabel = subscription?.unlimited ? 'Pro' : `Free ${subscription ? `(${subscription.loops_used}/${subscription.free_loop_limit})` : ''}`;

  return (
    <NavContext.Provider value={nav}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {canBack ? (
            <Pressable onPress={nav.back} hitSlop={10} style={{ marginRight: 12 }}>
              <Text style={styles.back}>‹ Back</Text>
            </Pressable>
          ) : null}
          <Text style={styles.brand}>Jobi</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={styles.planChip}><Text style={styles.planChipText}>{planLabel}</Text></View>
          <Pressable onPress={signOut} hitSlop={10}><Text style={styles.signOut}>Sign out</Text></Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Current {...(nav.route.params || {})} />
        <View style={{ height: 48 }} />
      </ScrollView>
    </NavContext.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={theme.colors.bg} />
        <Shell />
      </SafeAreaView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  brand: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  back: { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  body: { padding: 16 },
  planChip: { backgroundColor: theme.colors.chip, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, marginRight: 14 },
  planChipText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  signOut: { color: theme.colors.textDim, fontSize: 13 },
});
