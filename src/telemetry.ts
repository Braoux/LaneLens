import type { LocalStore } from './storage';
import type {
  AnalysisCompletedTelemetryContext,
  AnalysisFailedTelemetryContext,
  AnalysisStartedTelemetryContext,
  FeedbackOpenedTelemetryContext,
  FeedbackSubmittedTelemetryContext,
  HistoryOpenedTelemetryContext,
  TelemetryIdentityFields,
  TelemetryRequest,
} from '../shared/telemetry-contract';

export const TELEMETRY_CLIENT_ID_STORAGE_KEY = 'lanelens.alpha-client-id.v1';
export const TELEMETRY_SESSION_ID_STORAGE_KEY = 'lanelens.alpha-session-id.v1';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface TelemetryIdentity extends TelemetryIdentityFields {
  readonly isNewSession: boolean;
}

type UuidFactory = () => string;
type TelemetryPayload = TelemetryRequest extends infer Request
  ? Request extends TelemetryIdentityFields
    ? Omit<Request, keyof TelemetryIdentityFields>
    : never
  : never;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function readStoredUuid(storage: LocalStore | undefined, key: string): string | undefined {
  try {
    const value = storage?.getItem(key);
    return isUuid(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function persistUuid(storage: LocalStore | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // La télémétrie reste non bloquante lorsque le stockage est indisponible.
  }
}

function randomUuid(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function resolveTelemetryIdentity(
  localStorage: LocalStore | undefined,
  sessionStorage: LocalStore | undefined,
  uuid: UuidFactory = randomUuid,
): TelemetryIdentity {
  const storedClientId = readStoredUuid(localStorage, TELEMETRY_CLIENT_ID_STORAGE_KEY);
  const clientId = storedClientId ?? uuid();
  if (storedClientId === undefined) persistUuid(localStorage, TELEMETRY_CLIENT_ID_STORAGE_KEY, clientId);

  const storedSessionId = readStoredUuid(sessionStorage, TELEMETRY_SESSION_ID_STORAGE_KEY);
  const sessionId = storedSessionId ?? uuid();
  if (storedSessionId === undefined) persistUuid(sessionStorage, TELEMETRY_SESSION_ID_STORAGE_KEY, sessionId);

  return Object.freeze({ clientId, sessionId, isNewSession: storedSessionId === undefined });
}

function browserStore(name: 'localStorage' | 'sessionStorage'): LocalStore | undefined {
  try {
    return window[name];
  } catch {
    return undefined;
  }
}

export class TelemetryClient {
  private appOpenedSent = false;
  private readonly completedRequestIds = new Set<string>();

  constructor(
    private readonly identity: TelemetryIdentity,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  appOpened(): void {
    if (!this.identity.isNewSession || this.appOpenedSent) return;
    this.appOpenedSent = true;
    this.send({ event: 'app_opened' });
  }

  analysisStarted(context: AnalysisStartedTelemetryContext): void {
    this.send({ event: 'analysis_started', context });
  }

  analysisCompleted(context: AnalysisCompletedTelemetryContext): void {
    if (context.analysisRequestId !== undefined) {
      if (this.completedRequestIds.has(context.analysisRequestId)) return;
      this.completedRequestIds.add(context.analysisRequestId);
    }
    this.send({ event: 'analysis_completed', context });
  }

  analysisFailed(context: AnalysisFailedTelemetryContext): void {
    this.send({ event: 'analysis_failed', context });
  }

  historyOpened(context: HistoryOpenedTelemetryContext): void {
    this.send({ event: 'history_opened', context });
  }

  feedbackOpened(context: FeedbackOpenedTelemetryContext): void {
    this.send({ event: 'feedback_opened', context });
  }

  feedbackSubmitted(context: FeedbackSubmittedTelemetryContext): void {
    this.send({ event: 'feedback_submitted', context });
  }

  private send(payload: TelemetryPayload): void {
    const request = {
      clientId: this.identity.clientId,
      sessionId: this.identity.sessionId,
      ...payload,
    } as TelemetryRequest;
    try {
      const fetchTelemetry = this.fetchImpl;
      void fetchTelemetry('/api/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Une panne de télémétrie ne remonte jamais dans le parcours utilisateur.
    }
  }
}

export function createBrowserTelemetryClient(
  fetchImpl: typeof fetch = globalThis.fetch,
): TelemetryClient {
  return new TelemetryClient(resolveTelemetryIdentity(
    browserStore('localStorage'),
    browserStore('sessionStorage'),
  ), fetchImpl);
}
