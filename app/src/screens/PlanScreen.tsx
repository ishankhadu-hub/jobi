import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNav } from '../navigation';
import { Button, Card, H1, H2, P, ScoreBadge } from '../components/ui';
import { theme } from '../theme';

export default function PlanScreen({ plan, jd }: { plan: any; jd: any }) {
  const nav = useNav();
  return (
    <View>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <H1>Improvement plan</H1>
          <P dim>{jd?.role_title} · {jd?.company}</P>
        </View>
        {typeof plan?.overall_score === 'number' ? <ScoreBadge score={plan.overall_score} /> : null}
      </View>

      <Card>
        <H2>Readiness: {plan?.readiness || '—'}</H2>
        <P>{plan?.summary}</P>
      </Card>

      {(plan?.practise || []).length ? (
        <Card>
          <H2>Practise these</H2>
          {(plan.practise || []).map((p: string, i: number) => (
            <Text key={i} style={styles.item}>• {p}</Text>
          ))}
        </Card>
      ) : null}

      {(plan?.answers_to_rework || []).length ? (
        <Card style={{ borderColor: theme.colors.warn }}>
          <H2>Answers to rework</H2>
          {(plan.answers_to_rework || []).map((a: any, i: number) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{a.question}</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>{a.why}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {(plan?.gaps_to_address || []).length ? (
        <Card>
          <H2>Gaps to address</H2>
          {(plan.gaps_to_address || []).map((g: any, i: number) => (
            <Text key={i} style={styles.item}>• {typeof g === 'string' ? g : g.competency}</Text>
          ))}
        </Card>
      ) : null}

      {plan?.next_step ? (
        <Card style={{ borderColor: theme.colors.primary }}>
          <H2>Next step</H2>
          <P>{plan.next_step}</P>
        </Card>
      ) : null}

      <Button title="Start another application" onPress={() => nav.reset('home')} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  item: { color: theme.colors.text, fontSize: 15, lineHeight: 23, marginBottom: 4 },
});
