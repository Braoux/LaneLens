import type { MatchupAnalysis } from '../../server/analysis/types.js';
import {
  AnalysisConformanceValidator,
} from '../../server/analysis/AnalysisConformanceValidator.js';
import type { AnalysisRepairViolation } from '../../server/analysis/TargetedAnalysisRepair.js';
import { KnowledgeResolver } from '../../server/knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../../server/knowledge/StaticKnowledgeRepository.js';
import { VersionedPatchContextResolver } from '../../server/patch-context/VersionedPatchContextResolver.js';
import type { EvaluationResult, EvaluationResultsFile } from './types.js';
import type { RepairResult, RepairResultsFile } from './repair-types.js';

export type RevalidationStatus =
  | 'valid'
  | 'invalid_analysis'
  | 'shape_rejection'
  | 'analysis_unavailable';

export interface DiagnosticEnrichment {
  readonly code: string;
  readonly path: string;
  readonly previousSubject?: string;
  readonly subject?: string;
  readonly knowledgeId?: string;
}

export interface ObservationRevalidation {
  readonly id: string;
  readonly sourceStatus: string;
  readonly revalidationStatus: RevalidationStatus;
  readonly initialViolations: readonly AnalysisRepairViolation[];
  readonly violationsAfter: readonly AnalysisRepairViolation[];
  readonly removedViolations: readonly AnalysisRepairViolation[];
  readonly newlyDetectedViolations: readonly AnalysisRepairViolation[];
  readonly diagnosticsEnriched: readonly DiagnosticEnrichment[];
  readonly confirmedFalsePositiveRemovals?: readonly ConfirmedFalsePositiveRemoval[];
  readonly removalReviews?: readonly RemovalReviewResult[];
}

export type RemovalReviewClassification =
  | 'CONFIRMED_FALSE_POSITIVE'
  | 'DIAGNOSTIC_REASSOCIATION'
  | 'LEGITIMATE_DEDUPLICATION'
  | 'VALIDATOR_REGRESSION'
  | 'UNDETERMINED';

export interface RemovalReviewResult {
  readonly violation: AnalysisRepairViolation;
  readonly classification: RemovalReviewClassification;
  readonly reason: string;
}

export interface RemovalReviewEntry extends ConfirmedFalsePositiveReview {
  readonly classification: RemovalReviewClassification;
}

export interface ConfirmedFalsePositiveRemoval {
  readonly violation: AnalysisRepairViolation;
  readonly reason: string;
}

export interface ConfirmedFalsePositiveReview {
  readonly id: string;
  readonly code: string;
  readonly path: string;
  readonly subject?: string;
  readonly reason: string;
}

export interface RevalidationSummary {
  readonly observations: number;
  readonly revalidated: number;
  readonly shapeRejections: number;
  readonly unavailable: number;
  readonly validBefore: number;
  readonly validAfter: number;
  readonly invalidAfter: number;
  readonly violationsBefore: number;
  readonly violationsAfter: number;
  readonly removedViolations: number;
  readonly newlyDetectedViolations: number;
  readonly enrichedDiagnostics: number;
}

export interface RevalidationArtifact {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly sourceKind: 'evaluation' | 'repair';
  readonly summary: RevalidationSummary;
  readonly observations: readonly ObservationRevalidation[];
}

interface RevalidationCandidate {
  readonly id: string;
  readonly sourceStatus: string;
  readonly input: EvaluationResult['input'];
  readonly analysis?: MatchupAnalysis;
  readonly rejectionPhase?: EvaluationResult['rejectionPhase'];
  readonly violations: readonly AnalysisRepairViolation[];
}

function violationIdentity(violation: AnalysisRepairViolation): string {
  return [
    violation.code,
    violation.path,
    violation.subject ?? '',
    violation.knowledgeId ?? '',
  ].join('|');
}

function sameDiagnosticLocation(
  left: AnalysisRepairViolation,
  right: AnalysisRepairViolation,
): boolean {
  return left.code === right.code && left.path === right.path;
}

function compareViolations(
  before: readonly AnalysisRepairViolation[],
  after: readonly AnalysisRepairViolation[],
): Pick<ObservationRevalidation, 'removedViolations' | 'newlyDetectedViolations' | 'diagnosticsEnriched'> {
  const beforeKeys = new Set(before.map(violationIdentity));
  const afterKeys = new Set(after.map(violationIdentity));
  const diagnosticsEnriched = before.flatMap((previous) => {
    const current = after.find((candidate) =>
      sameDiagnosticLocation(previous, candidate)
      && previous.subject !== candidate.subject
      && candidate.subject !== undefined
      && candidate.knowledgeId !== undefined);
    return current === undefined ? [] : [{
      code: current.code,
      path: current.path,
      ...(previous.subject === undefined ? {} : { previousSubject: previous.subject }),
      subject: current.subject,
      knowledgeId: current.knowledgeId,
    }];
  });
  return {
    removedViolations: before.filter((violation) => !afterKeys.has(violationIdentity(violation))),
    newlyDetectedViolations: after.filter((violation) => !beforeKeys.has(violationIdentity(violation))),
    diagnosticsEnriched,
  };
}

function evaluationCandidates(file: EvaluationResultsFile): readonly RevalidationCandidate[] {
  return file.results.map((result) => ({
    id: result.id,
    sourceStatus: result.status,
    input: result.input,
    analysis: result.analysis ?? result.candidateAnalysis,
    rejectionPhase: result.rejectionPhase,
    violations: result.violations ?? [],
  }));
}

function repairCandidates(file: RepairResultsFile): readonly RevalidationCandidate[] {
  return file.results.map((result: RepairResult) => ({
    id: result.id,
    sourceStatus: result.status,
    input: result.input,
    analysis: result.finalAnalysis,
    violations: result.finalViolations ?? [],
  }));
}

async function revalidateCandidates(
  candidates: readonly RevalidationCandidate[],
  sourceKind: RevalidationArtifact['sourceKind'],
  generatedAt: string,
): Promise<RevalidationArtifact> {
  const validator = new AnalysisConformanceValidator();
  const knowledgeResolver = new KnowledgeResolver(new StaticKnowledgeRepository());
  const patchResolver = new VersionedPatchContextResolver();
  const patchContexts = new Map<string, Awaited<ReturnType<VersionedPatchContextResolver['resolve']>>>();
  const observations: ObservationRevalidation[] = [];

  for (const candidate of candidates) {
    if (candidate.analysis === undefined) {
      const revalidationStatus = candidate.rejectionPhase === 'shape'
        ? 'shape_rejection'
        : 'analysis_unavailable';
      observations.push({
        id: candidate.id,
        sourceStatus: candidate.sourceStatus,
        revalidationStatus,
        initialViolations: candidate.violations,
        violationsAfter: [],
        removedViolations: [],
        newlyDetectedViolations: [],
        diagnosticsEnriched: [],
      });
      continue;
    }

    let patchResolution = patchContexts.get(candidate.input.patch);
    if (patchResolution === undefined) {
      patchResolution = await patchResolver.resolve(candidate.input.patch);
      patchContexts.set(candidate.input.patch, patchResolution);
    }
    const knowledge = knowledgeResolver.resolve({
      champions: [
        candidate.input.allyCarry,
        candidate.input.allySupport,
        candidate.input.enemyCarry,
        candidate.input.enemySupport,
      ],
      patch: candidate.input.patch,
      phases: ['lane', 'level-1', 'level-2', 'level-3', 'level-6-plus'],
    });
    const result = validator.validate(
      candidate.analysis,
      knowledge,
      patchResolution.status === 'ready' ? patchResolution.context : undefined,
    );
    const comparison = compareViolations(candidate.violations, result.violations);
    observations.push({
      id: candidate.id,
      sourceStatus: candidate.sourceStatus,
      revalidationStatus: result.valid ? 'valid' : 'invalid_analysis',
      initialViolations: candidate.violations,
      violationsAfter: result.violations,
      ...comparison,
    });
  }

  const revalidated = observations.filter(({ revalidationStatus }) =>
    revalidationStatus === 'valid' || revalidationStatus === 'invalid_analysis');
  const summary: RevalidationSummary = {
    observations: observations.length,
    revalidated: revalidated.length,
    shapeRejections: observations.filter(({ revalidationStatus }) =>
      revalidationStatus === 'shape_rejection').length,
    unavailable: observations.filter(({ revalidationStatus }) =>
      revalidationStatus === 'analysis_unavailable').length,
    validBefore: observations.filter(({ sourceStatus }) => sourceStatus === 'success').length,
    validAfter: observations.filter(({ revalidationStatus }) => revalidationStatus === 'valid').length,
    invalidAfter: observations.filter(({ revalidationStatus }) =>
      revalidationStatus === 'invalid_analysis').length,
    violationsBefore: observations.reduce((total, observation) =>
      total + observation.initialViolations.length, 0),
    violationsAfter: observations.reduce((total, observation) =>
      total + observation.violationsAfter.length, 0),
    removedViolations: observations.reduce((total, observation) =>
      total + observation.removedViolations.length, 0),
    newlyDetectedViolations: observations.reduce((total, observation) =>
      total + observation.newlyDetectedViolations.length, 0),
    enrichedDiagnostics: observations.reduce((total, observation) =>
      total + observation.diagnosticsEnriched.length, 0),
  };
  return {
    schemaVersion: 1,
    generatedAt,
    sourceKind,
    summary,
    observations,
  };
}

export async function revalidateEvaluationResults(
  file: EvaluationResultsFile,
  generatedAt = new Date().toISOString(),
): Promise<RevalidationArtifact> {
  return revalidateCandidates(evaluationCandidates(file), 'evaluation', generatedAt);
}

export async function revalidateRepairResults(
  file: RepairResultsFile,
  generatedAt = new Date().toISOString(),
): Promise<RevalidationArtifact> {
  return revalidateCandidates(repairCandidates(file), 'repair', generatedAt);
}

export function applyConfirmedFalsePositiveReview(
  artifact: RevalidationArtifact,
  review: readonly ConfirmedFalsePositiveReview[],
): RevalidationArtifact {
  const matched = new Set<ConfirmedFalsePositiveReview>();
  const observations = artifact.observations.map((observation) => {
    const removals = review.flatMap((entry) => {
      if (entry.id !== observation.id) return [];
      const violation = observation.removedViolations.find((candidate) =>
        candidate.code === entry.code
        && candidate.path === entry.path
        && (entry.subject === undefined || candidate.subject === entry.subject));
      if (violation === undefined) return [];
      matched.add(entry);
      return [{ violation, reason: entry.reason }];
    });
    return removals.length === 0
      ? observation
      : {
          ...observation,
          confirmedFalsePositiveRemovals: removals,
          removalReviews: [
            ...(observation.removalReviews ?? []),
            ...removals.map(({ violation, reason }) => ({
              violation,
              classification: 'CONFIRMED_FALSE_POSITIVE' as const,
              reason,
            })),
          ],
        };
  });
  const unmatched = review.filter((entry) => !matched.has(entry));
  if (unmatched.length > 0) {
    throw new Error(`La revue contient ${unmatched.length} suppression(s) non confirmée(s) par la revalidation : ${unmatched.map(({ id, code, path }) => `${id} ${code} ${path}`).join(', ')}.`);
  }
  return { ...artifact, observations };
}

export function applyRemovalReview(
  artifact: RevalidationArtifact,
  review: readonly RemovalReviewEntry[],
): RevalidationArtifact {
  const matched = new Set<RemovalReviewEntry>();
  const observations = artifact.observations.map((observation) => {
    const removals = review.flatMap((entry) => {
      if (entry.id !== observation.id) return [];
      const violation = observation.removedViolations.find((candidate) =>
        candidate.code === entry.code
        && candidate.path === entry.path
        && (entry.subject === undefined || candidate.subject === entry.subject));
      if (violation === undefined) return [];
      matched.add(entry);
      return [{
        violation,
        classification: entry.classification,
        reason: entry.reason,
      }];
    });
    return removals.length === 0
      ? observation
      : {
          ...observation,
          removalReviews: [...(observation.removalReviews ?? []), ...removals],
        };
  });
  const unmatched = review.filter((entry) => !matched.has(entry));
  if (unmatched.length > 0) {
    throw new Error(`La revue contient ${unmatched.length} suppression(s) non confirmée(s) par la revalidation : ${unmatched.map(({ id, code, path }) => `${id} ${code} ${path}`).join(', ')}.`);
  }
  return { ...artifact, observations };
}
