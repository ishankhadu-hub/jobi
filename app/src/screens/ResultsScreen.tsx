import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNav } from '../navigation';
import { api, ApiError } from '../api';
import { Button, Card, H1, H2, P, ChipRow, ErrorBanner } from '../components/ui';
import { theme } from '../theme';
import { exportDocx, Block } from '../lib/docx';

export default function ResultsScreen({ prepared }: { prepared: any }) {
  const nav = useNav();
  const jd = prepared.job_description;
  const tailored = prepared.tailored_resume;
  const cover = prepared.cover_letter;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<any>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const startInterview = async () => {
    setStarting(true);
    setError(null);
    try {
      const res: any = await api.interviewStart(jd.id);
      nav.go('interview', { start: res, jd });
    } catch (e) {
      if (e instanceof ApiError && e.isUpgradeRequired) return nav.go('paywall', {});
      setError(e);
    } finally {
      setStarting(false);
    }
  };

  const exportResume = async () => {
    setExporting('resume');
    try {
      const blocks: Block[] = [
        { text: tailored.headline || `${jd.role_title} — ${jd.company}`, heading: 1 },
        ...(tailored.summary ? [{ text: tailored.summary } as Block] : []),
        { text: 'Experience', heading: 2 },
        ...(tailored.bullets || []).map((b: any) => ({ text: `• ${b.text}` } as Block)),
        ...((tailored.gaps || []).length ? [{ text: 'Gaps to address (not on resume)', heading: 2 } as Block] : []),
        ...(tailored.gaps || []).map((g: any) => ({ text: `• ${g.competency}: ${g.note}` } as Block)),
      ];
      await exportDocx(`Resume - ${jd.company}`, blocks);
    } catch (e) { setError(e); } finally { setExporting(null); }
  };

  const exportCover = async () => {
    setExporting('cover');
    try {
      const blocks: Block[] = [
        { text: cover.subject || `Cover letter — ${jd.company}`, heading: 1 },
        { text: cover.body || '' },
      ];
      await exportDocx(`Cover letter - ${jd.company}`, blocks);
    } catch (e) { setError(e); } finally { setExporting(null); }
  };

  return (
    <View>
      <H1>{jd.role_title}</H1>
      <P dim>{jd.company} · {jd.seniority || 'role'}{prepared.jd_cached ? ' · (JD parse reused from cache)' : ''}</P>

      <View style={{ height: 12 }} />
      <Card>
        <H2>What the role really wants</H2>
        <P dim>Competencies</P>
        <ChipRow items={jd.competencies || []} />
        <P dim style={{ marginTop: 8 }}>Skills / keywords</P>
        <ChipRow items={(jd.skills || []).concat(jd.keywords || []).slice(0, 16)} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <H2>Tailored resume</H2>
          <Button title={exporting === 'resume' ? '…' : 'Export .docx'} variant="ghost" onPress={exportResume} loading={exporting === 'resume'} />
        </View>
        {tailored.summary ? <P style={{ marginBottom: 8 }}>{tailored.summary}</P> : null}
        {(tailored.bullets || []).map((b: any, i: number) => (
          <View key={i} style={styles.bullet}>
            <Text style={styles.bulletDot}>•</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.bulletText}>{b.text}</Text>
              {b.original && b.original !== b.text ? (
                <Text style={styles.original}>from: “{b.original}”</Text>
              ) : null}
            </View>
          </View>
        ))}
        {tailored.fabrication_check ? (
          <View style={styles.fabCheck}>
            <Text style={{ color: theme.colors.success, fontSize: 13 }}>✓ {tailored.fabrication_check}</Text>
          </View>
        ) : null}
      </Card>

      {(tailored.gaps || []).length ? (
        <Card style={{ borderColor: theme.colors.warn }}>
          <H2>Gaps flagged (not fabricated)</H2>
          <P dim>These competencies have no evidence in your resume. Address them honestly — don't invent them.</P>
          {(tailored.gaps || []).map((g: any, i: number) => (
            <View key={i} style={{ marginTop: 8 }}>
              <Text style={{ color: theme.colors.warn, fontWeight: '700' }}>{g.competency}</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>{g.note}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <View style={styles.rowBetween}>
          <H2>Cover letter</H2>
          <Button title={exporting === 'cover' ? '…' : 'Export .docx'} variant="ghost" onPress={exportCover} loading={exporting === 'cover'} />
        </View>
        {cover.subject ? <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 6 }}>{cover.subject}</Text> : null}
        <P>{cover.body}</P>
      </Card>

      <ErrorBanner error={error} onRetry={error ? startInterview : undefined} />
      <Button title="Start mock interview →" onPress={startInterview} loading={starting} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  bullet: { flexDirection: 'row', marginBottom: 10 },
  bulletDot: { color: theme.colors.primary, marginRight: 8, fontSize: 16 },
  bulletText: { color: theme.colors.text, fontSize: 15, lineHeight: 21 },
  original: { color: theme.colors.textDim, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  fabCheck: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
});
