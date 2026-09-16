import { describe, expect, it } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import fixtures from './testdata/decisionCurrentViews.json';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { presentFlowerApproval } from './flowerApprovalPresentation';

const summary = {
  thread_id: 'thread-fixture', title: 'Decision', title_status: 'ready', title_generation: 1,
  model_id: 'test/decision', working_dir: '/', settings_revision: 1,
  created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Desktop', target_labels: [], messages: [],
  read_status: { is_unread: false, snapshot: { activity_revision: 0 }, read_state: { last_seen_activity_revision: 0 } },
} satisfies FlowerThreadSnapshot;
const copy = {
  title: 'Allow this action?', editFile: 'Edit file', runCommand: 'Run command',
  accessNetwork: 'Access network', outsideWorkspaceRisk: 'Outside workspace', writesFilesRisk: 'Changes files',
  executeRequestedAction: 'Execute requested action', workingDirectory: (target: string) => `Working directory: ${target}`,
};

// TestFlowerDecisionCurrentFixtures verifies these fixtures against real provider
// calls, the published Floret runtime, and Redeven tool definitions.
describe('published runtime decision content', () => {
  it('preserves the rich question and explicit mode even without a custom label', () => {
    const result = applyFlowerRuntimeCurrentView(summary, fixtures.ask_rich as FlowerRuntimeCurrentView);
    expect(result.input_request?.questions[0]).toMatchObject({
      header: 'Release channel', question: 'Which release channel should Flower use?',
      response_mode: 'select_or_write', choices_exhaustive: false, write_placeholder: 'Describe another channel',
      choices: [{ choice_id: 'stable', value: 'Stable', label: 'Stable', description: 'Use the version tested for production.' },
        { choice_id: 'beta', value: 'Beta', label: 'Beta', description: 'Try new features before general release.' }],
    });
  });
  it('does not invent descriptions for sparse choices', () => {
    const result = applyFlowerRuntimeCurrentView(summary, fixtures.ask_sparse as FlowerRuntimeCurrentView);
    expect(result.input_request?.questions[0].response_mode).toBe('select');
    expect(result.input_request?.questions[0].choices?.every((choice) => !choice.description)).toBe(true);
  });
  it('keeps string-only historical and tool input valid without inventing a header', () => {
    const current: FlowerRuntimeCurrentView = { ...fixtures.ask_sparse as FlowerRuntimeCurrentView,
      interactions: [{ ...fixtures.ask_sparse.interactions[0], kind: 'input', input: { summary: 'Continue?',
        questions: [{ id: 'q', prompt: 'Continue?', kind: 'select_or_write', options: ['Continue', 'Stop'] }] } }] };
    const question = applyFlowerRuntimeCurrentView(summary, current).input_request?.questions[0];
    expect(question).toMatchObject({ header: '', response_mode: 'select_or_write',
      choices: [{ choice_id: 'Continue', label: 'Continue' }, { choice_id: 'Stop', label: 'Stop' }] });
    expect(question?.choices_exhaustive).toBeUndefined();
    expect(question?.write_placeholder).toBeUndefined();
  });
  it.each(['approval_date', 'approval_date_zh'] as const)('retains the actual purpose of %s', (name) => {
    const current = fixtures[name] as FlowerRuntimeCurrentView;
    const result = applyFlowerRuntimeCurrentView(summary, current);
    const presentation = presentFlowerApproval(result.approval_actions![0], copy);
    expect(presentation.operationLabel).toBe(current.interactions![0].approval!.label);
    expect(presentation.description).toBeUndefined();
    expect(presentation.command).toBe('date');
    expect(presentation.targets).toEqual([]);
    expect(presentation.details).toEqual([]);
  });
});
