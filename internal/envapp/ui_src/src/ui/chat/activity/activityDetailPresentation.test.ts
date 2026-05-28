import { describe, expect, it } from 'vitest';

import { normalizeActivityDetail } from './activityDetailPresentation';
import type { ActivityDetailRef, ActivityItem } from '../types';

const baseItem: ActivityItem = {
  itemId: 'item-1',
  toolId: 'tool-1',
  toolName: 'shell',
  renderer: 'command',
  status: 'success',
  label: 'Run tests',
  targetRefs: [{ kind: 'command', label: 'npm test' }],
};

const inlineRef: ActivityDetailRef = {
  refId: 'detail-1',
  kind: 'terminal',
  fetchMode: 'inline',
  title: '',
};

describe('activityDetailPresentation', () => {
  it('keeps fixed activity detail chrome as i18n keys while preserving raw terminal content', () => {
    const detail = normalizeActivityDetail(baseItem, inlineRef, {
      status: 'success',
      stdout: 'PASS src/main.test.ts',
      stderr: 'warning: raw stderr stays literal',
      duration_ms: 1200,
      exit_code: 0,
    });

    expect(detail.chips).toEqual(expect.arrayContaining([
      expect.objectContaining({ labelKey: 'chatActivity.status.success' }),
      expect.objectContaining({ labelKey: 'chatActivity.chip.duration', value: '1.2s' }),
      expect.objectContaining({ labelKey: 'chatActivity.chip.exit', value: '0' }),
    ]));
    expect(detail.copyTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'command', labelKey: 'chatActivity.copyTarget.command', text: 'npm test' }),
      expect.objectContaining({ id: 'stdout', labelKey: 'chatActivity.copyTarget.stdout', text: 'PASS src/main.test.ts' }),
      expect.objectContaining({ id: 'stderr', labelKey: 'chatActivity.copyTarget.stderr', text: 'warning: raw stderr stays literal' }),
    ]));
  });

  it('uses semantic section labels for structured fallback details', () => {
    const detail = normalizeActivityDetail({
      ...baseItem,
      renderer: 'unknown',
      label: '',
      targetRefs: [],
    }, { ...inlineRef, kind: 'tool_detail' }, {
      args: { query: 'Flower prompt text should remain literal.' },
      result: { total: 2 },
    });

    expect(detail.titleKey).toBe('chatActivity.fallback.toolDetail');
    expect(detail.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'structured_fields',
        titleKey: 'chatActivity.sectionTitle.toolDetails',
        groups: expect.arrayContaining([
          expect.objectContaining({ titleKey: 'chatActivity.sectionTitle.arguments' }),
          expect.objectContaining({ titleKey: 'chatActivity.sectionTitle.result' }),
        ]),
      }),
    ]));
  });

  it('keeps todo copy summaries meaningful when UI uses a localized fallback label', () => {
    const detail = normalizeActivityDetail({
      ...baseItem,
      renderer: 'todos',
    }, { ...inlineRef, kind: 'todo_delta' }, {
      result: {
        todos: [
          { id: 'todo-1', status: 'pending' },
        ],
      },
    });

    expect(detail.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'todo_delta',
        items: [expect.objectContaining({
          contentKey: 'chatActivity.fallback.untitledTodo',
        })],
      }),
    ]));
    expect(detail.copyTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'todos',
        text: 'pending:',
        textKey: 'chatActivity.fallback.untitledTodo',
        textPrefixSeparator: ':',
      }),
    ]));
  });
});
