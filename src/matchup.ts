import type { Champion } from './champions';
import { DEFAULT_LOCALE } from '../shared/locale';
import type { AppLocale } from '../shared/locale';

export const SLOT_IDS = ['allyCarry', 'allySupport', 'enemyCarry', 'enemySupport'] as const;
export type SlotId = (typeof SLOT_IDS)[number];
export type Team = 'ally' | 'enemy';

export interface MatchupSelection {
  readonly allyCarry: Champion;
  readonly allySupport: Champion;
  readonly enemyCarry: Champion;
  readonly enemySupport: Champion;
}

export type DraftSelection = Partial<Record<SlotId, Champion>>;
export type UnavailableReason = 'same-team' | 'opponent-duplicate' | 'maximum-occurrences';

export function teamFor(slot: SlotId): Team {
  return slot.startsWith('ally') ? 'ally' : 'enemy';
}

export function championUnavailableReason(
  selection: DraftSelection,
  targetSlot: SlotId,
  championId: string,
  mirrorEnabled: boolean,
): UnavailableReason | undefined {
  const occurrences = SLOT_IDS.filter((slot) => slot !== targetSlot && selection[slot]?.id === championId);
  if (occurrences.length >= 2) return 'maximum-occurrences';
  if (occurrences.some((slot) => teamFor(slot) === teamFor(targetSlot))) return 'same-team';
  if (occurrences.length === 1 && !mirrorEnabled) return 'opponent-duplicate';
  return undefined;
}

export function canSelectChampion(
  selection: DraftSelection,
  targetSlot: SlotId,
  championId: string,
  mirrorEnabled: boolean,
): boolean {
  return championUnavailableReason(selection, targetSlot, championId, mirrorEnabled) === undefined;
}

export function selectChampion(
  selection: DraftSelection,
  targetSlot: SlotId,
  champion: Champion,
  mirrorEnabled: boolean,
): DraftSelection {
  if (!canSelectChampion(selection, targetSlot, champion.id, mirrorEnabled)) return selection;
  return Object.freeze({ ...selection, [targetSlot]: champion });
}

export function isCompleteSelection(selection: DraftSelection): selection is MatchupSelection {
  return SLOT_IDS.every((slot) => selection[slot] !== undefined);
}

export function snapshotSelection(selection: DraftSelection): MatchupSelection | undefined {
  if (!isCompleteSelection(selection)) return undefined;
  return Object.freeze({
    allyCarry: Object.freeze({ ...selection.allyCarry }),
    allySupport: Object.freeze({ ...selection.allySupport }),
    enemyCarry: Object.freeze({ ...selection.enemyCarry }),
    enemySupport: Object.freeze({ ...selection.enemySupport }),
  });
}

export function searchChampions(champions: readonly Champion[], query: string, locale: AppLocale = DEFAULT_LOCALE): readonly Champion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  if (!normalizedQuery) return champions;
  return champions.filter((champion) => champion.name.toLocaleLowerCase(locale).includes(normalizedQuery));
}
