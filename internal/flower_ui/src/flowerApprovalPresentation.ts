import type { FlowerApprovalAction, FlowerSafeTarget } from './contracts/flowerSurfaceContracts';

export type FlowerApprovalPresentationCopy = Readonly<{
  title: string;
  editFile: (target: string) => string;
  runCommand: string;
  accessNetwork: (target: string) => string;
  executeAction: (label: string) => string;
  executeRequestedAction: string;
  workingDirectory: (target: string) => string;
}>;

export type FlowerApprovalPresentation = Readonly<{
  title: string;
  operationLabel: string;
  targets: readonly string[];
  command?: string;
  details: readonly string[];
  risk?: string;
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

  if (fileMutationTools.has(toolName) && fileTargets.length > 0) {
    const firstTarget = fileTargets[0]?.label ?? '';
    const formatted = copy.editFile(firstTarget);
    operationLabel = firstTarget
      ? formatted.slice(0, Math.max(0, formatted.length - firstTarget.length)).trim().replace(/[:：]\s*$/, '')
      : formatted.trim().replace(/[:：]\s*$/, '');
    displayTargets = fileTargets.map((target) => target.label);
  } else if (commandTools.has(toolName)) {
    operationLabel = copy.runCommand;
  } else if (networkTools.has(toolName) && networkTargets.length > 0) {
    const firstTarget = networkTargets[0]?.label ?? '';
    const formatted = copy.accessNetwork(firstTarget);
    operationLabel = firstTarget
      ? formatted.slice(0, Math.max(0, formatted.length - firstTarget.length)).trim().replace(/[:：]\s*$/, '')
      : formatted.trim().replace(/[:：]\s*$/, '');
    displayTargets = networkTargets.map((target) => target.label);
  } else {
    const label = safeSummaryLabel(action);
    operationLabel = label ? copy.executeAction(label) : copy.executeRequestedAction;
  }

  return {
    title: copy.title,
    operationLabel,
    targets: displayTargets,
    ...(command ? { command } : {}),
    details: workingDirectories.map((target) => copy.workingDirectory(target.label)),
    ...(action.summary.description?.trim() ? { risk: action.summary.description.trim() } : {}),
  };
}
