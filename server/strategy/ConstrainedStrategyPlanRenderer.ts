import type { AppLocale } from '../../shared/locale.js';
import { AnalysisConformanceValidator, type AnalysisConformanceViolation } from '../analysis/AnalysisConformanceValidator.js';
import { AnalysisLanguageValidator, type AnalysisLanguageViolation } from '../analysis/AnalysisLanguageValidator.js';
import type { MatchupAnalysis } from '../analysis/types.js';
import { validateMatchupAnalysis } from '../analysis/validation.js';
import type { MatchupFactPack } from '../knowledge/MatchupFactPack.js';
import type { MatchupStrategyPlan } from './MatchupStrategyPlan.js';
import {
  StrategyPlanPreRenderValidator,
  type StrategyPlanPreRenderResult,
} from './StrategyPlanPreRenderValidator.js';
import {
  analysisInputFromFactPack,
  gameplayContextFromFactPack,
  patchContextFromFactPack,
} from './StrategyPlanFactPackAdapter.js';

export interface ConstrainedRenderDiagnostic {
  readonly code: 'PRE_RENDER_REJECTED' | 'TARGET_PRIORITY_UNRESOLVED' | 'INVALID_RENDERED_SHAPE';
  readonly path: string;
  readonly reason: string;
}

export interface FinalAnalysisValidation {
  readonly valid: boolean;
  readonly shapeValid: boolean;
  readonly conformanceViolations: readonly AnalysisConformanceViolation[];
  readonly languageViolations: readonly AnalysisLanguageViolation[];
}

export interface ConstrainedRenderResult {
  readonly status: 'success' | 'pre_render_rejected' | 'render_rejected' | 'final_validation_rejected';
  readonly preRenderValidation: StrategyPlanPreRenderResult;
  readonly diagnostics: readonly ConstrainedRenderDiagnostic[];
  readonly analysis?: MatchupAnalysis;
  readonly finalValidation?: FinalAnalysisValidation;
}

function participantChampion(factPack: MatchupFactPack, participantId: string): string | undefined {
  return factPack.participants.find((participant) => participant.participantId === participantId)?.champion;
}

function targetChampion(plan: MatchupStrategyPlan, factPack: MatchupFactPack): string | undefined {
  const enemyIds = new Set<string>(factPack.participants
    .filter(({ team }) => team === 'enemy')
    .map(({ participantId }) => participantId));
  const targets = [...new Set(plan.targetPriority.participantIds.filter((id) => enemyIds.has(id)))];
  return targets.length === 1 ? participantChampion(factPack, targets[0]!) : undefined;
}

function renderAnalysis(
  plan: MatchupStrategyPlan,
  factPack: MatchupFactPack,
  primaryTarget: string,
): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: participantChampion(factPack, 'ally:carry')!,
      allySupport: participantChampion(factPack, 'ally:support')!,
      enemyCarry: participantChampion(factPack, 'enemy:carry')!,
      enemySupport: participantChampion(factPack, 'enemy:support')!,
      patch: factPack.patch,
    },
    lanePlan: plan.laneApproach.text,
    threatResponseWindow: {
      threat: plan.threatResponseWindow.threat.text,
      response: plan.threatResponseWindow.response.text,
      window: plan.threatResponseWindow.tradeWindow.text,
      winCondition: plan.threatResponseWindow.winCondition.text,
    },
    earlyLevels: {
      level1: plan.earlyLevels.level1.text,
      level2: plan.earlyLevels.level2.text,
      level3: plan.earlyLevels.level3.text,
    },
    wavePlan: plan.wavePlan.text,
    targetPriority: {
      primaryTarget,
      explanation: plan.targetPriority.text,
    },
    postLevel6: plan.postLevel6.text,
    roamPlan: plan.roamPlan.text,
    cheatSheet: [
      plan.threatResponseWindow.response.text,
      plan.threatResponseWindow.tradeWindow.text,
      plan.wavePlan.text,
      plan.roamPlan.text,
    ],
    goldenRule: plan.threatResponseWindow.winCondition.text,
  };
}

export class ConstrainedStrategyPlanRenderer {
  constructor(
    private readonly preRenderValidator = new StrategyPlanPreRenderValidator(),
    private readonly conformanceValidator = new AnalysisConformanceValidator(),
    private readonly languageValidator = new AnalysisLanguageValidator(),
  ) {}

  render(
    plan: MatchupStrategyPlan,
    factPack: MatchupFactPack,
    locale: AppLocale,
  ): ConstrainedRenderResult {
    const preRenderValidation = this.preRenderValidator.validate(plan, factPack);
    if (!preRenderValidation.valid) {
      return Object.freeze({
        status: 'pre_render_rejected',
        preRenderValidation,
        diagnostics: Object.freeze([{
          code: 'PRE_RENDER_REJECTED' as const,
          path: '$',
          reason: 'The Strategy Plan must pass pre-render validation before rendering.',
        }]),
      });
    }

    const primaryTarget = targetChampion(plan, factPack);
    if (primaryTarget === undefined) {
      return Object.freeze({
        status: 'render_rejected',
        preRenderValidation,
        diagnostics: Object.freeze([{
          code: 'TARGET_PRIORITY_UNRESOLVED' as const,
          path: 'targetPriority.participantIds',
          reason: 'Target priority must reference exactly one enemy participant.',
        }]),
      });
    }

    const input = analysisInputFromFactPack(factPack, locale);
    const candidate = renderAnalysis(plan, factPack, primaryTarget);
    let analysis: MatchupAnalysis;
    try {
      analysis = validateMatchupAnalysis(candidate, input);
    } catch {
      return Object.freeze({
        status: 'render_rejected',
        preRenderValidation,
        diagnostics: Object.freeze([{
          code: 'INVALID_RENDERED_SHAPE' as const,
          path: '$',
          reason: 'The deterministic renderer produced an invalid MatchupAnalysis shape.',
        }]),
      });
    }

    const conformance = this.conformanceValidator.validate(
      analysis,
      gameplayContextFromFactPack(factPack),
      patchContextFromFactPack(factPack),
    );
    const language = this.languageValidator.validate(analysis, locale);
    const finalValidation = Object.freeze({
      valid: conformance.valid && language.valid,
      shapeValid: true,
      conformanceViolations: conformance.violations,
      languageViolations: language.violations,
    });
    return Object.freeze({
      status: finalValidation.valid ? 'success' : 'final_validation_rejected',
      preRenderValidation,
      diagnostics: Object.freeze([]),
      analysis,
      finalValidation,
    });
  }
}
