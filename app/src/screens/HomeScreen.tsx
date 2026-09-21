import React, { useState } from 'react';
import { View } from 'react-native';
import { useNav } from '../navigation';
import { api, ApiError } from '../api';
import { Button, Card, Field, H1, H2, P, ErrorBanner, Loading } from '../components/ui';

const SAMPLE_JD = `Senior React Native Engineer at Nimbus
Nimbus is hiring a Senior React Native Engineer. You'll build cross-platform mobile apps with Expo and TypeScript, integrate GraphQL and Postgres, own features end to end, mentor two junior engineers, and work closely with product. Strong communication and ownership are essential. Nice to have: payments experience and CI/CD.`;

const SAMPLE_RESUME = `Priya Sharma
priya@example.com
- Built and shipped a React Native app (Expo) used by 12,000 monthly users
- Worked with Node.js and Postgres to build an internal payments dashboard
- Mentored 2 junior engineers through weekly pairing
- Reduced CI pipeline time by 40% by parallelising test suites`;

export default function HomeScreen() {
  const nav = useNav();
  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);

  const generate = async () => {
    if (!jd.trim() || !resume.trim()) {
      setError(new Error('Paste both a job description and your resume.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.prepare(resume, jd);
      nav.go('results', { prepared: res });
    } catch (e) {
      if (e instanceof ApiError && e.isUpgradeRequired) return nav.go('paywall', {});
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (busy) {
    return <Loading label="Parsing the role, tailoring your resume, writing a cover letter, and preparing questions… (many model calls — this is the whole chain)" />;
  }

  return (
    <View>
      <H1>New application</H1>
      <P dim>The agent parses the role, tailors your resume to it (without inventing anything), writes a cover letter, and preps interview questions.</P>
      <View style={{ height: 16 }} />
      <Card>
        <H2>Job description</H2>
        <Field value={jd} onChangeText={setJd} placeholder="Paste the full job description…" multiline minHeight={140} />
        <Button title="Use sample JD" variant="ghost" onPress={() => setJd(SAMPLE_JD)} />
      </Card>
      <Card>
        <H2>Your resume</H2>
        <Field value={resume} onChangeText={setResume} placeholder="Paste your resume text…" multiline minHeight={160} />
        <Button title="Use sample resume" variant="ghost" onPress={() => setResume(SAMPLE_RESUME)} />
      </Card>
      <ErrorBanner error={error} onRetry={error ? generate : undefined} />
      <Button title="Generate tailored resume + cover letter" onPress={generate} />
    </View>
  );
}
