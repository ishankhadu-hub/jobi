import React from 'react';
import { View, Linking, Text, StyleSheet } from 'react-native';
import { useNav } from '../navigation';
import { useAuth } from '../auth';
import { config } from '../config';
import { Button, Card, H1, H2, P } from '../components/ui';
import { theme } from '../theme';

export default function PaywallScreen() {
  const nav = useNav();
  const { user, subscription, refreshSubscription } = useAuth();

  // Paddle uses an EXTERNAL web checkout. We pass the user id as custom_data so
  // the webhook can tie the subscription back to this account.
  const openCheckout = () => {
    const base = config.paddleCheckoutUrl;
    if (!base) {
      Linking.openURL('https://www.paddle.com'); // placeholder until you set EXPO_PUBLIC_PADDLE_CHECKOUT_URL
      return;
    }
    const sep = base.includes('?') ? '&' : '?';
    Linking.openURL(`${base}${sep}customer_id=${encodeURIComponent(user?.id || '')}&custom_data=${encodeURIComponent(JSON.stringify({ user_id: user?.id }))}`);
  };

  return (
    <View>
      <H1>Upgrade to Pro</H1>
      <P dim>
        You've used your {subscription?.free_loop_limit ?? 1} free coaching loop
        {subscription?.free_loop_limit === 1 ? '' : 's'}. Pro gives you unlimited tailored resumes, cover letters, and mock interviews.
      </P>
      <View style={{ height: 16 }} />
      <Card>
        <H2>Jobi Pro</H2>
        <Text style={styles.price}>Unlimited coaching loops</Text>
        <P dim>Checkout opens in your browser (Paddle). After paying, come back and tap “I've upgraded”.</P>
        <View style={{ height: 12 }} />
        <Button title="Open checkout" onPress={openCheckout} />
        <View style={{ height: 10 }} />
        <Button title="I've upgraded — refresh" variant="ghost" onPress={async () => { await refreshSubscription(); nav.back(); }} />
      </Card>
      <Button title="Not now" variant="ghost" onPress={() => nav.reset('home')} />
    </View>
  );
}

const styles = StyleSheet.create({
  price: { color: theme.colors.text, fontSize: 20, fontWeight: '800', marginBottom: 6 },
});
