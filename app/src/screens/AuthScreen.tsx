import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../auth';
import { useSupabaseAuth, config } from '../config';
import { Button, Card, Field, H1, P, ErrorBanner } from '../components/ui';
import { theme } from '../theme';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'up') await signUp(email.trim(), password, fullName.trim());
      else await signIn(email.trim(), password);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <View style={{ height: 40 }} />
      <H1>Jobi</H1>
      <P dim>Paste a job description and your resume. Get a tailored resume, a cover letter, and a full mock interview with a coach.</P>
      <View style={{ height: 20 }} />
      <Card>
        <ErrorBanner error={error} />
        {mode === 'up' ? <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Priya Sharma" autoCapitalize="words" /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
        <Button title={mode === 'up' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
        <View style={{ height: 10 }} />
        <Button
          title={mode === 'up' ? 'I already have an account' : "I'm new — create an account"}
          variant="ghost"
          onPress={() => { setMode(mode === 'up' ? 'in' : 'up'); setError(null); }}
        />
      </Card>
      <Text style={styles.mode}>
        Auth: {useSupabaseAuth ? 'Supabase' : 'local dev'} · API: {config.apiUrl}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20 },
  mode: { color: theme.colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
