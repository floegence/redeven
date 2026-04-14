import { compareReleaseVersionCore, isReleaseVersion } from './agentVersion';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';

const RUNTIME_UPDATE_PROMPT_STORAGE_PREFIX = 'redeven_envapp_update_prompt_v1:';

export type RuntimeUpdatePromptMemory = Readonly<{
  shown_on_date?: string;
  shown_target_version?: string;
  skipped_version?: string;
  updated_at_ms?: number;
}>;

export type RuntimeUpdatePromptDecisionInput = Readonly<{
  accessGateVisible: boolean;
  isLocalMode: boolean;
  upgradePolicy?: string;
  protocolStatus: string;
  canAdmin: boolean;
  envStatus: string;
  maintaining: boolean;
  currentVersion: string;
  preferredTargetVersion: string;
  latestStale: boolean;
  promptMemory?: RuntimeUpdatePromptMemory | null;
  today: string;
}>;

function normalizeEnvId(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

function normalizeVersion(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

function normalizeStatus(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

function sanitizePromptMemory(input: unknown): RuntimeUpdatePromptMemory {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, unknown>;

  const shownOnDate = String(raw.shown_on_date ?? '').trim();
  const shownTargetVersion = normalizeVersion(raw.shown_target_version as string | undefined);
  const skippedVersion = normalizeVersion(raw.skipped_version as string | undefined);
  const updatedAtMs = Number(raw.updated_at_ms ?? 0);

  return {
    shown_on_date: shownOnDate || undefined,
    shown_target_version: shownTargetVersion || undefined,
    skipped_version: skippedVersion || undefined,
    updated_at_ms: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.floor(updatedAtMs) : undefined,
  };
}

export function formatLocalDateStamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function runtimeUpdatePromptStorageKey(envId: string): string {
  const id = normalizeEnvId(envId);
  if (!id) return '';
  return `${RUNTIME_UPDATE_PROMPT_STORAGE_PREFIX}${id}`;
}

export function readRuntimeUpdatePromptMemory(envId: string): RuntimeUpdatePromptMemory {
  const key = runtimeUpdatePromptStorageKey(envId);
  if (!key) return {};
  return sanitizePromptMemory(readUIStorageJSON(key, null));
}

export function writeRuntimeUpdatePromptMemory(envId: string, next: RuntimeUpdatePromptMemory): RuntimeUpdatePromptMemory {
  const key = runtimeUpdatePromptStorageKey(envId);
  const sanitized = sanitizePromptMemory(next);
  if (!key) return sanitized;
  writeUIStorageJSON(key, sanitized);

  return sanitized;
}

export function wasPromptShownTodayForTarget(record: RuntimeUpdatePromptMemory | null | undefined, targetVersion: string, today: string): boolean {
  const target = normalizeVersion(targetVersion);
  if (!target) return false;
  const sanitized = sanitizePromptMemory(record);
  return sanitized.shown_on_date === String(today ?? '').trim() && sanitized.shown_target_version === target;
}

export function isVersionSkipped(record: RuntimeUpdatePromptMemory | null | undefined, targetVersion: string): boolean {
  const target = normalizeVersion(targetVersion);
  if (!target) return false;
  return sanitizePromptMemory(record).skipped_version === target;
}

export function markRuntimeUpdatePromptShown(
  envId: string,
  targetVersion: string,
  today: string = formatLocalDateStamp(),
  nowMs: number = Date.now(),
): RuntimeUpdatePromptMemory {
  const current = readRuntimeUpdatePromptMemory(envId);
  return writeRuntimeUpdatePromptMemory(envId, {
    ...current,
    shown_on_date: String(today ?? '').trim() || undefined,
    shown_target_version: normalizeVersion(targetVersion) || undefined,
    updated_at_ms: Math.floor(nowMs),
  });
}

export function markRuntimeUpdateVersionSkipped(envId: string, targetVersion: string, nowMs: number = Date.now()): RuntimeUpdatePromptMemory {
  const current = readRuntimeUpdatePromptMemory(envId);
  return writeRuntimeUpdatePromptMemory(envId, {
    ...current,
    skipped_version: normalizeVersion(targetVersion) || undefined,
    updated_at_ms: Math.floor(nowMs),
  });
}

export function clearRuntimeUpdateSkippedVersionIfMatched(envId: string, targetVersion: string, nowMs: number = Date.now()): RuntimeUpdatePromptMemory {
  const current = readRuntimeUpdatePromptMemory(envId);
  const target = normalizeVersion(targetVersion);
  if (!target || current.skipped_version !== target) return current;

  return writeRuntimeUpdatePromptMemory(envId, {
    ...current,
    skipped_version: undefined,
    updated_at_ms: Math.floor(nowMs),
  });
}

export function shouldShowRuntimeUpdatePrompt(input: RuntimeUpdatePromptDecisionInput): boolean {
  if (input.accessGateVisible) return false;
  if (input.isLocalMode) return false;
  if (normalizeStatus(input.upgradePolicy) !== 'self_upgrade') return false;
  if (normalizeStatus(input.protocolStatus) !== 'connected') return false;
  if (!input.canAdmin) return false;
  if (normalizeStatus(input.envStatus) !== 'online') return false;
  if (input.maintaining) return false;
  if (input.latestStale) return false;

  const currentVersion = normalizeVersion(input.currentVersion);
  const targetVersion = normalizeVersion(input.preferredTargetVersion);
  if (!isReleaseVersion(currentVersion)) return false;
  if (!isReleaseVersion(targetVersion)) return false;

  const compare = compareReleaseVersionCore(currentVersion, targetVersion);
  if (compare == null || compare >= 0) return false;

  if (isVersionSkipped(input.promptMemory, targetVersion)) return false;
  if (wasPromptShownTodayForTarget(input.promptMemory, targetVersion, input.today)) return false;
  return true;
}
