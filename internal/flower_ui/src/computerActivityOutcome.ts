import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';

// Display semantics only. Canonical tool status and execution authority remain
// unchanged. Neither message wording nor an unrelated later success is proof.
export function computerObservationInterruption(item: FlowerActivityItem): 'unavailable' | 'effect_confirmed' | 'prepared' | 'partial_input' | 'budget' | 'output' | undefined {
  if (item.status !== 'error' || !/^(computer|browser)\./u.test(item.tool_name ?? '')) return;
  const chips = item.chips ?? [];
  const phase = chips.find(chip => chip.kind === 'computer_failure_phase')?.value;
  if (item.field_summary?.uncertain_effect || phase === 'unknown' || chips.some(chip => chip.kind === 'effect_outcome' && chip.value === 'uncertain')
    || item.requires_approval && item.approval_state !== 'approved' || item.approval_state && item.approval_state !== 'approved') return;
  const error = item.payload?.error;
  const code = error && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>).code : undefined;
  if ((code === undefined || ['SCRIPT_OUTPUT_LIMIT','SCRIPT_FAILED'].includes(String(code))) && chips.some(chip => chip.kind === 'computer_budget' && chip.value === 'output')) return 'output';
  if ((code === undefined || ['TIMEOUT','SCRIPT_FAILED'].includes(String(code))) && chips.some(chip => chip.kind === 'computer_budget' && ['time','operations'].includes(chip.value ?? ''))) return 'budget';
  if (code !== undefined && code !== 'TARGET_OBSERVATION_UNAVAILABLE') return;
  if (code !== 'TARGET_OBSERVATION_UNAVAILABLE' && !chips.some(chip => chip.kind === 'computer_observation' && chip.value === 'unavailable')) return;
  return phase === 'effect_confirmed' || phase === 'prepared' || phase === 'partial_input' ? phase : 'unavailable';
}

export const isPresentedToolFailure = (item: FlowerActivityItem): boolean => item.status === 'error' && !computerObservationInterruption(item);
