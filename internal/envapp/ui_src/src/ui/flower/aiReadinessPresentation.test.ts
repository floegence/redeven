import { describe, expect, it } from 'vitest';

import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import {
  normalizeAIReadinessSnapshot,
  type AIReadinessReasonCode,
  type AIReadinessSnapshot,
} from './aiReadiness';
import { createAIReadinessPresentation, type AIReadinessAction } from './aiReadinessPresentation';

const i18n = createTestI18nHelpers('en-US');

function blocked(
  reasonCode: AIReadinessReasonCode,
  overrides: Partial<AIReadinessSnapshot> = {},
): AIReadinessSnapshot {
  return {
    state: 'blocked',
    reason_code: reasonCode,
    retryable: false,
    safe_to_retry: false,
    ...overrides,
  };
}

type ReasonActionCase = Readonly<{
  reasonCode: AIReadinessReasonCode;
  primaryAction: AIReadinessAction;
  secondaryAction?: AIReadinessAction;
  title: string;
  safeRetry?: boolean;
}>;

const reasonActionCases: readonly ReasonActionCase[] = [
  { reasonCode: 'temporarily_blocked', primaryAction: 'retry', secondaryAction: 'show_diagnostics', title: 'Agent is temporarily unavailable', safeRetry: true },
  { reasonCode: 'update_required', primaryAction: 'open_update', secondaryAction: 'show_diagnostics', title: 'Redeven needs an update' },
  { reasonCode: 'unsupported_store', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
  { reasonCode: 'store_integrity_error', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
  { reasonCode: 'environment_permission_error', primaryAction: 'open_permissions', secondaryAction: 'show_diagnostics', title: 'Redeven cannot access Agent data' },
  { reasonCode: 'store_io_error', primaryAction: 'retry', secondaryAction: 'show_diagnostics', title: 'Agent is temporarily unavailable', safeRetry: true },
  { reasonCode: 'cancelled', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
  { reasonCode: 'contract_error', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
  { reasonCode: 'ai_service_startup_error', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
  { reasonCode: 'ai_readiness_contract_error', primaryAction: 'show_diagnostics', title: 'Agent data needs checking' },
];

describe('createAIReadinessPresentation', () => {
  it('fails closed for contradictory wire facts', () => {
    expect(normalizeAIReadinessSnapshot(blocked('store_io_error', {
      retryable: false,
      safe_to_retry: true,
    }))).toEqual(blocked('ai_readiness_contract_error'));
  });

  it.each(reasonActionCases)('maps $reasonCode to concise copy and actions', (testCase) => {
    const projection = createAIReadinessPresentation(blocked(testCase.reasonCode, testCase.safeRetry
      ? { retryable: true, safe_to_retry: true }
      : {}), i18n);

    expect(projection.mode).toBe('blocked');
    expect(projection.title).toBe(testCase.title);
    expect(projection.primaryAction).toBe(testCase.primaryAction);
    expect(projection.secondaryAction).toBe(testCase.secondaryAction);
  });

  it.each([
    ['unavailable', 'busy', 'Checking Agent data'],
    ['inspecting', 'busy', 'Checking Agent data'],
    ['optimizing', 'busy', 'Preparing Agent data'],
    ['migrating', 'busy', 'Safely updating Agent data'],
    ['verifying', 'busy', 'Finishing the Agent data update'],
    ['recovering', 'busy', 'Preparing Agent data'],
    ['ready', 'ready', 'Ready'],
  ] as const)('maps %s to the %s presentation mode', (state, mode, title) => {
    const projection = createAIReadinessPresentation({
      state,
      reason_code: '',
      retryable: false,
      safe_to_retry: false,
    }, i18n);

    expect(projection.mode).toBe(mode);
    expect(projection.title).toBe(title);
    expect(projection.primaryAction).toBeUndefined();
    expect(projection.secondaryAction).toBeUndefined();
  });

  it('does not offer retry without both safe facts and current permission', () => {
    const unsafe = createAIReadinessPresentation(blocked('temporarily_blocked', {
      retryable: true,
      safe_to_retry: false,
    }), i18n);
    expect(unsafe.primaryAction).toBe('show_diagnostics');
    expect(unsafe.secondaryAction).toBeUndefined();

    const unauthorized = createAIReadinessPresentation(blocked('temporarily_blocked', {
      retryable: true,
      safe_to_retry: true,
    }), i18n, { canRetryGeneration: false });
    expect(unauthorized.primaryAction).toBe('show_diagnostics');
    expect(unauthorized.secondaryAction).toBeUndefined();
  });

  it('projects only phase, elapsed time, status, and sanitized trace ID', () => {
    const sensitiveFixture = {
      ...blocked('store_io_error', {
        retryable: true,
        safe_to_retry: true,
        trace_id: 'ai-start-safe',
        startup_phase: 'verifying',
      }),
      path: '/Users/alice/private/agent.sqlite',
      sql: 'SELECT * FROM agent_turns',
      credential: 'sk-sensitive',
      message_content: 'private prompt',
    } as AIReadinessSnapshot;
    const projection = createAIReadinessPresentation(sensitiveFixture, i18n, { elapsedMs: 31_000 });

    expect(projection.diagnosticRows).toEqual([
      { label: 'Phase', value: 'Final check' },
      { label: 'Elapsed', value: '31s' },
      { label: 'Status', value: 'Stopped' },
      { label: 'Trace ID', value: 'ai-start-safe' },
    ]);
    expect(projection.diagnosticText).toBe(projection.diagnosticRows
      .map((row) => `${row.label}: ${row.value}`)
      .join('\n'));
    expect(projection.diagnosticText).not.toMatch(/private|SELECT|sk-sensitive|store_io_error/u);
  });
});
