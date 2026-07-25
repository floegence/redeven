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
    committed: false,
    rolled_back: false,
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
  { reasonCode: 'temporarily_blocked', primaryAction: 'retry', secondaryAction: 'show_diagnostics', title: 'Agent data is temporarily in use', safeRetry: true },
  { reasonCode: 'update_required', primaryAction: 'open_update', secondaryAction: 'show_diagnostics', title: 'Redeven needs an update' },
  { reasonCode: 'unsupported_store', primaryAction: 'show_diagnostics', title: 'This Agent data cannot be opened here' },
  { reasonCode: 'store_integrity_error', primaryAction: 'show_diagnostics', title: 'Agent data needs attention' },
  { reasonCode: 'environment_permission_error', primaryAction: 'open_permissions', secondaryAction: 'show_diagnostics', title: 'Redeven cannot access Agent data' },
  { reasonCode: 'store_io_error', primaryAction: 'retry', secondaryAction: 'show_diagnostics', title: 'Agent data is unavailable', safeRetry: true },
  { reasonCode: 'configuration_error', primaryAction: 'show_diagnostics', title: 'Agent storage configuration does not match' },
  { reasonCode: 'migration_rolled_back', primaryAction: 'retry', secondaryAction: 'show_diagnostics', title: 'The Agent data update was rolled back', safeRetry: true },
  { reasonCode: 'post_commit_verification_error', primaryAction: 'show_diagnostics', title: 'The Agent data update needs verification' },
  { reasonCode: 'cancelled', primaryAction: 'show_diagnostics', title: 'The Agent data check was interrupted' },
  { reasonCode: 'contract_error', primaryAction: 'show_diagnostics', title: 'Flower is unavailable' },
  { reasonCode: 'ai_service_startup_error', primaryAction: 'show_diagnostics', title: 'Flower could not start' },
  { reasonCode: 'ai_readiness_contract_error', primaryAction: 'show_diagnostics', title: 'Flower is unavailable' },
];

describe('createAIReadinessPresentation', () => {
  it.each([
    blocked('store_io_error', { retryable: false, safe_to_retry: true }),
    blocked('migration_rolled_back', { rolled_back: false }),
    blocked('post_commit_verification_error', { committed: false }),
  ])('fails closed before presentation for contradictory wire facts: %#', (value) => {
    expect(normalizeAIReadinessSnapshot(value)).toEqual(blocked('ai_readiness_contract_error'));
  });

  it.each(reasonActionCases)('maps $reasonCode to safe copy and actions', (testCase) => {
    const projection = createAIReadinessPresentation(blocked(testCase.reasonCode, testCase.safeRetry
      ? { retryable: true, safe_to_retry: true }
      : {}), i18n);

    expect(projection.mode).toBe('blocked');
    expect(projection.title).toBe(testCase.title);
    expect(projection.primaryAction).toBe(testCase.primaryAction);
    expect(projection.secondaryAction).toBe(testCase.secondaryAction);
  });

  it.each([
    ['unavailable', 'busy', 'Flower is starting'],
    ['inspecting', 'busy', 'Checking Agent data'],
    ['migrating', 'busy', 'Updating Agent data'],
    ['verifying', 'busy', 'Verifying Agent data'],
    ['ready', 'ready', 'Ready'],
  ] as const)('maps %s to the %s presentation mode', (state, mode, title) => {
    const projection = createAIReadinessPresentation({
      state,
      reason_code: '',
      retryable: false,
      safe_to_retry: false,
      committed: false,
      rolled_back: false,
    }, i18n);

    expect(projection.mode).toBe(mode);
    expect(projection.title).toBe(title);
    expect(projection.primaryAction).toBeUndefined();
    expect(projection.secondaryAction).toBeUndefined();
  });

  it.each([
    'temporarily_blocked',
    'unsupported_store',
    'store_integrity_error',
    'store_io_error',
    'migration_rolled_back',
    'post_commit_verification_error',
  ] satisfies readonly AIReadinessReasonCode[])('does not offer retry for unsafe %s facts', (reasonCode) => {
    const projection = createAIReadinessPresentation(blocked(reasonCode, {
      retryable: true,
      safe_to_retry: false,
      committed: reasonCode === 'post_commit_verification_error',
      rolled_back: reasonCode === 'migration_rolled_back',
    }), i18n);

    expect(projection.primaryAction).toBe('show_diagnostics');
    expect(projection.secondaryAction).toBeUndefined();
  });

  it.each([
    'unsupported_store',
    'store_integrity_error',
    'post_commit_verification_error',
  ] satisfies readonly AIReadinessReasonCode[])('offers a secondary retry for explicitly safe %s facts', (reasonCode) => {
    const projection = createAIReadinessPresentation(blocked(reasonCode, {
      retryable: true,
      safe_to_retry: true,
      committed: reasonCode === 'post_commit_verification_error',
    }), i18n);

    expect(projection.primaryAction).toBe('show_diagnostics');
    expect(projection.secondaryAction).toBe('retry');
  });

  it('does not offer retry when the current user cannot restart the AI generation', () => {
    const projection = createAIReadinessPresentation(blocked('temporarily_blocked', {
      retryable: true,
      safe_to_retry: true,
    }), i18n, { canRetryGeneration: false });

    expect(projection.primaryAction).toBe('show_diagnostics');
    expect(projection.secondaryAction).toBeUndefined();
  });

  it('fails closed when called with an unknown reason', () => {
    const projection = createAIReadinessPresentation({
      ...blocked('contract_error'),
      reason_code: 'future_reason',
      retryable: false,
      safe_to_retry: false,
    } as unknown as AIReadinessSnapshot, i18n);

    expect(projection.title).toBe('Flower is unavailable');
    expect(projection.primaryAction).toBe('show_diagnostics');
    expect(projection.secondaryAction).toBeUndefined();
    expect(`${projection.title} ${projection.description} ${projection.dataStatement}`).not.toMatch(/force|reset|repair|ignore/iu);
  });

  it('builds displayed rows and clipboard text from one sanitized projection', () => {
    const sensitiveFixture = {
      ...blocked('store_io_error', {
        retryable: true,
        safe_to_retry: true,
        committed: true,
      }),
      path: '/Users/alice/private/agent.sqlite',
      sql: 'SELECT * FROM agent_turns',
      credential: 'sk-sensitive',
      provider_state: 'opaque-provider-state',
      message_content: 'private prompt',
      tool_output: 'private command output',
    } as AIReadinessSnapshot;
    const projection = createAIReadinessPresentation(sensitiveFixture, i18n);
    const textFromRows = projection.diagnosticRows
      .map((row) => `${row.label}: ${row.value}`)
      .join('\n');

    expect(projection.diagnosticText).toBe(textFromRows);
    expect(projection.diagnosticRows).toEqual([
      { label: 'Owner', value: 'Floret Store' },
      { label: 'Status', value: 'Blocked' },
      { label: 'Check again allowed', value: 'Yes' },
      { label: 'Data update committed', value: 'Yes' },
      { label: 'Data update rolled back', value: 'No' },
    ]);
    for (const sensitiveValue of [
      'store_io_error',
      '/Users/alice/private/agent.sqlite',
      'agent_turns',
      'sk-sensitive',
      'opaque-provider-state',
      'private prompt',
      'private command output',
    ]) {
      expect(projection.diagnosticText).not.toContain(sensitiveValue);
    }
  });
});
