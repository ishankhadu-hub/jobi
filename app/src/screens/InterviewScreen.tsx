import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNav } from '../navigation';
import { api, ApiError } from '../api';
import { Button, Card, H1, H2, P, Field, ErrorBanner, ScoreBadge, Loading } from '../components/ui';
import { theme } from '../theme';

type Turn = { question: string; category?: string; isFollowUp?: boolean; score?: any };

export default function InterviewScreen({ start, jd }: { start: any; jd: any }) {
  const nav = useNav();
  const [sessionId] = useState<string>(start.session_id);
  const [current, setCurrent] = useState<any>(start.question); // {text, category, is_follow_up}
  const [progress, setProgress] = useState<any>(start.progress);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  const [done, setDone] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

  const submit = async () => {
    if (!answer.trim()) { setError(new Error('Type an answer first.')); return; }
    setBusy(true);
    setError(null);
    const askedQuestion = current?.text;
    const askedCat = current?.category;
    const wasFollowUp = current?.is_follow_up;
    try {
      const res: any = await api.interviewAnswer(sessionId, answer);
      setHistory((h) => [...h, { question: askedQuestion, category: askedCat, isFollowUp: wasFollowUp, score: res.score }]);
      setAnswer('');
      setProgress(res.progress);
      if (res.done) {
        setDone(true);
        setCurrent(null);
      } else {
        setCurrent(res.next_question);
      }
    } catch (e) {
      if (e instanceof ApiError && e.isUpgradeRequired) return nav.go('paywall', {});
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const seePlan = async () => {
    setPlanBusy(true);
    setError(null);
    try {
      const res: any = await api.interviewPlan(sessionId);
      nav.go('plan', { plan: res.improvement_plan, sessionId, jd });
    } catch (e) {
      setError(e);
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <View>
      <H1>Mock interview</H1>
      <P dim>{jd?.role_title} · {jd?.company}{progress ? ` · question ${progress.asked}/${progress.max}` : ''}</P>

      {/* Transcript so far */}
      {history.map((t, i) => (
        <Card key={i} style={{ backgroundColor: theme.colors.cardAlt }}>
          <View style={styles.qRow}>
            <Text style={styles.qLabel}>{t.isFollowUp ? 'Follow-up' : (t.category || 'Q')}</Text>
            {t.score ? <ScoreBadge score={t.score.value} /> : null}
          </View>
          <Text style={styles.q}>{t.question}</Text>
          {t.score?.strengths?.length ? (
            <Text style={styles.good}>👍 {t.score.strengths[0]}</Text>
          ) : null}
          {t.score?.improvements?.length ? (
            <Text style={styles.improve}>🔧 {t.score.improvements[0]}</Text>
          ) : null}
          {t.score?.rewrite_hint ? <Text style={styles.hint}>Rewrite: {t.score.rewrite_hint}</Text> : null}
        </Card>
      ))}

      {busy ? (
        <Loading label="Scoring your answer and deciding the next question…" />
      ) : done ? (
        <Card style={{ borderColor: theme.colors.success }}>
          <H2>That's a wrap 🎉</H2>
          <P dim>You answered {history.length} question(s). Compile your improvement plan next.</P>
          <ErrorBanner error={error} onRetry={error ? seePlan : undefined} />
          <Button title="See my improvement plan →" onPress={seePlan} loading={planBusy} />
        </Card>
      ) : current ? (
        <Card style={{ borderColor: theme.colors.primary }}>
          <Text style={styles.qLabel}>{current.is_follow_up ? 'Follow-up' : (current.category || 'Question')}</Text>
          <Text style={styles.currentQ}>{current.text}</Text>
          <Field value={answer} onChangeText={setAnswer} placeholder="Type your answer… (use STAR: Situation, Task, Action, Result)" multiline minHeight={130} />
          <ErrorBanner error={error} onRetry={error ? submit : undefined} />
          <Button title="Submit answer" onPress={submit} />
          {/* VOICE SEAM (later): a mic button here would STT into `answer`, and the
              server already returns voice.speak for TTS of the next question. */}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  qLabel: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'capitalize', marginBottom: 4 },
  q: { color: theme.colors.text, fontSize: 15, marginBottom: 6 },
  currentQ: { color: theme.colors.text, fontSize: 18, fontWeight: '600', marginBottom: 12, lineHeight: 25 },
  good: { color: theme.colors.success, fontSize: 13, marginTop: 4 },
  improve: { color: theme.colors.warn, fontSize: 13, marginTop: 4 },
  hint: { color: theme.colors.textDim, fontSize: 12, marginTop: 6, fontStyle: 'italic' },
});
