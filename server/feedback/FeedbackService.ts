import { createHash } from 'node:crypto';
import type { FeedbackRequest } from '../../shared/feedback-contract.js';
import type { FeedbackIssueDraft, FeedbackTracker } from './types.js';

const ANALYSIS_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  champion_mechanic: 'Mécanique de champion incorrecte',
  timing_level: 'Timing / niveau incorrect',
  ability_interaction: 'Interaction entre sorts incorrecte',
  tactical_advice: 'Conseil tactique douteux',
  incoherent_text: 'Texte incohérent ou incompréhensible',
  other: 'Autre',
};

const BUG_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  ui_display: 'Interface / affichage',
  analysis_loading: 'Analyse qui ne se charge pas',
  champion_selection: 'Sélection des champions',
  history: 'Historique',
  responsive_mobile: 'Responsive / mobile',
  unexpected_error: 'Erreur inattendue',
  other: 'Autre',
};

function analysisId(feedback: Extract<FeedbackRequest, { kind: 'analysis' }>): string {
  const { matchup, client } = feedback;
  return createHash('sha256').update(JSON.stringify([
    matchup.patch,
    matchup.allyCarry,
    matchup.allySupport,
    matchup.enemyCarry,
    matchup.enemySupport,
    client.requestId ?? '',
  ])).digest('hex').slice(0, 20);
}

function safeTrackerText(value: string): string {
  return value
    .replaceAll('\r', '')
    .replaceAll('@', '＠')
    .replaceAll('<', '‹')
    .replaceAll('>', '›');
}

function titleText(value: string): string {
  return safeTrackerText(value).replaceAll(/\s+/gu, ' ').trim();
}

function line(label: string, value: string | number | undefined): string {
  const rendered = value === undefined || value === '' ? 'Non disponible' : String(value);
  return `${label}: ${safeTrackerText(rendered)}`;
}

function commonLines(feedback: FeedbackRequest, receivedAt: string): readonly string[] {
  return [
    line('Date', receivedAt),
    line('Vue', feedback.client.view),
    line('Viewport', `${feedback.client.viewport.width}x${feedback.client.viewport.height}`),
    line('Version LaneLens', feedback.client.appVersion),
    line('Request ID', feedback.client.requestId),
    line('User agent', feedback.client.userAgent),
    line('Commentaire', feedback.comment),
  ];
}

function issueDraft(feedback: FeedbackRequest, receivedAt: string): FeedbackIssueDraft {
  if (feedback.kind === 'analysis') {
    const { matchup } = feedback;
    const category = ANALYSIS_CATEGORY_LABELS[feedback.category] ?? 'Autre';
    return {
      title: titleText(`[Analysis feedback] ${matchup.allyCarry} + ${matchup.allySupport} vs ${matchup.enemyCarry} + ${matchup.enemySupport} — ${category}`),
      body: [
        line('Patch', matchup.patch),
        line('Analysis ID', analysisId(feedback)),
        line('Catégorie', feedback.category),
        ...commonLines(feedback, receivedAt),
      ].join('\n'),
      labels: ['feedback', 'alpha', 'analysis-error', 'gameplay'],
    };
  }

  const category = BUG_CATEGORY_LABELS[feedback.category] ?? 'Autre';
  return {
    title: titleText(`[Bug] ${feedback.client.view} — ${category}`),
    body: [
      line('Catégorie', feedback.category),
      ...commonLines(feedback, receivedAt),
    ].join('\n'),
    labels: ['feedback', 'alpha', 'bug', feedback.category === 'responsive_mobile' || feedback.category === 'ui_display' ? 'ui' : 'bug'],
  };
}

export class FeedbackService {
  constructor(
    private readonly tracker: FeedbackTracker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(feedback: FeedbackRequest): Promise<void> {
    await this.tracker.create(issueDraft(feedback, this.now().toISOString()));
  }
}
