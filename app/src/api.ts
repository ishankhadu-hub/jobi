/**
 * The single client for all backend calls. The app talks to n8n/orchestrator
 * webhooks ONLY (config.apiUrl) — never to an LLM, never holding a secret.
 *
 * Handles the failure modes MOCK_MODE deliberately simulates:
 *   • 429 rate-limit  -> bounded auto-retry with backoff, then a typed
 *     RateLimitError the UI shows as a friendly "try again" banner.
 *   • network / 5xx   -> typed ApiError; one retry on network blips.
 */
import { config } from './config';

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterMs?: number;
  constructor(message: string, status: number, code?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
  get isRateLimited() {
    return this.status === 429 || this.code === 'rate_limited';
  }
  get isUpgradeRequired() {
    return this.status === 402 || this.code === 'upgrade_required';
  }
}

let authToken: string | null = null;
export function setAuthToken(t: string | null) {
  authToken = t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  opts: { retries?: number; auth?: boolean } = {}
): Promise<T> {
  const retries = opts.retries ?? 2;
  const url = `${config.apiUrl}${path}`;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(opts.auth !== false && authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      // Network blip — retry once.
      if (attempt < 1) {
        attempt++;
        await sleep(500);
        continue;
      }
      throw new ApiError(`Can't reach the server. Is it running at ${config.apiUrl}?`, 0, 'network');
    }

    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (res.ok) return json as T;

    const err = new ApiError(json.message || json.error || `Request failed (${res.status})`, res.status, json.error, json.retry_after_ms);
    // Bounded auto-retry on rate limit / transient upstream.
    const transient = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (transient && attempt < retries) {
      attempt++;
      const backoff = err.retryAfterMs || 700 * Math.pow(2, attempt);
      await sleep(backoff);
      continue;
    }
    throw err;
  }
}

export const api = {
  // Auth (dev-orchestrator path). Real Supabase auth is handled in auth.tsx.
  signup: (email: string, password: string, full_name?: string) =>
    request('POST', '/webhook/auth/signup', { email, password, full_name }, { auth: false }),
  login: (email: string, password: string) =>
    request('POST', '/webhook/auth/login', { email, password }, { auth: false }),

  me: () => request('GET', '/webhook/me'),
  subscription: () => request('GET', '/webhook/subscription'),

  saveResume: (content: string, title?: string) => request('POST', '/webhook/resume', { content, title }),

  // The front half of the loop in one call: parse (cached) + tailor + cover + questions.
  prepare: (resume: string, jobDescription: string) =>
    request('POST', '/webhook/prepare', { resume, jobDescription }),

  parseJd: (jobDescription: string) => request('POST', '/webhook/parse-jd', { jobDescription }),
  questions: (jobDescriptionId: string) => request('POST', '/webhook/questions', { jobDescriptionId }),

  interviewStart: (jobDescriptionId: string) => request('POST', '/webhook/interview/start', { jobDescriptionId }),
  interviewAnswer: (sessionId: string, answer: string, audioUrl?: string) =>
    request('POST', '/webhook/interview/answer', { sessionId, answer, audioUrl }),
  interviewPlan: (sessionId: string) => request('POST', '/webhook/interview/plan', { sessionId }),
  getSession: (sessionId: string) => request('GET', `/webhook/interview/${sessionId}`),
};

export { request };
