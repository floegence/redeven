import type { FlowerApprovalAction, FlowerSafeTarget } from './contracts/flowerSurfaceContracts';

export type FlowerApprovalPresentationCopy = Readonly<{
  title: string;
  editFile: string;
  runCommand: string;
  accessNetwork: string;
  outsideWorkspaceRisk: string;
  writesFilesRisk: string;
  executeRequestedAction: string;
  workingDirectory: (target: string) => string;
}>;

export type FlowerApprovalPresentation = Readonly<{
  title: string;
  operationLabel: string;
  operationKind: 'file' | 'terminal' | 'network' | 'other';
  risk?: string;
  targets: readonly string[];
  command?: string;
  details: readonly string[];
  description?: string;
}>;

const fileMutationTools = new Set(['file.write', 'file.edit', 'apply_patch']);
const commandTools = new Set(['terminal.exec']);
const networkTools = new Set(['web_fetch', 'web.search']);

function targetsOfKind(targets: readonly FlowerSafeTarget[], ...kinds: readonly string[]): readonly FlowerSafeTarget[] {
  const accepted = new Set(kinds);
  return targets.filter((target) => accepted.has(target.kind) && target.label.trim());
}

function safeSummaryLabel(action: FlowerApprovalAction): string {
  const label = action.summary.label.trim();
  if (!label || label === action.tool_name.trim() || /^(?:[a-z][a-z0-9_-]*\.)+[a-z][a-z0-9_-]*$/i.test(label)) return '';
  return label;
}

export function presentFlowerApproval(
  action: FlowerApprovalAction,
  copy: FlowerApprovalPresentationCopy,
): FlowerApprovalPresentation {
  const toolName = action.tool_name.trim();
  const targets = action.summary.targets ?? [];
  const fileTargets = targetsOfKind(targets, 'file');
  const networkTargets = targetsOfKind(targets, 'web_url', 'web_query');
  const workingDirectories = targetsOfKind(targets, 'working_directory');
  const commandTarget = targetsOfKind(targets, 'command')[0]?.label.trim();
  const command = action.summary.command?.trim() || commandTarget || '';
  let operationLabel = copy.executeRequestedAction;
  let displayTargets: readonly string[] = [];

  const operationKind = fileMutationTools.has(toolName) ? 'file'
    : commandTools.has(toolName) ? 'terminal'
      : networkTools.has(toolName) ? 'network' : 'other';
  if (operationKind === 'file') {
    operationLabel = copy.editFile;
    displayTargets = fileTargets.map((target) => target.label);
  } else if (operationKind === 'terminal') {
    operationLabel = copy.runCommand;
  } else if (operationKind === 'network') {
    operationLabel = copy.accessNetwork;
    displayTargets = networkTargets.map((target) => target.label);
  }
  const risk = action.summary.risk?.trim() || [
    action.summary.flags?.includes('open_world') ? copy.outsideWorkspaceRisk : '',
    operationKind === 'file' && action.summary.effects?.includes('write') ? copy.writesFilesRisk : '',
  ].filter(Boolean).join(' ');
  const description = action.summary.description?.trim() || '';
  const label = safeSummaryLabel(action);
  operationLabel = (label !== command ? label : '') || description || operationLabel;

  return {
    title: copy.title,
    operationLabel,
    operationKind,
    ...(risk ? { risk } : {}),
    targets: displayTargets,
    ...(command ? { command } : {}),
    details: workingDirectories.map((target) => copy.workingDirectory(target.label)),
    ...(description && description !== operationLabel ? { description } : {}),
  };
}
