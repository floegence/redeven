import { Show, type JSX } from 'solid-js';
import { Button, Tooltip } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';

const deleteReviewLoadingReason = 'Reviewing branch deletion...';
const deleteReviewMissingReason = 'Choose a branch to review its deletion plan.';
const safeDeleteBlockedReason = 'Safe delete is blocked.';

function trimReason(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function resolveDeleteBranchConfirmDisabledReason(options: {
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  loading?: boolean;
  deleting?: boolean;
  blockingReason?: string;
}): string {
  if (options.deleting) return '';
  if (options.loading) return deleteReviewLoadingReason;

  const previewError = trimReason(options.previewError);
  if (previewError) return previewError;

  if (!options.branch || !options.preview) {
    return deleteReviewMissingReason;
  }

  const blockingReason = trimReason(options.blockingReason);
  if (blockingReason) return blockingReason;

  if (!options.preview.safeDeleteAllowed) {
    return trimReason(options.preview.safeDeleteReason) || safeDeleteBlockedReason;
  }

  return '';
}

export interface GitDeleteBranchConfirmButtonProps {
  label: string;
  disabled: boolean;
  disabledReason?: string;
  loading?: boolean;
  class?: string;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

export function GitDeleteBranchConfirmButton(props: GitDeleteBranchConfirmButtonProps) {
  const disabledReason = () => trimReason(props.disabledReason);
  const renderButton = () => (
    <Button
      size="sm"
      variant="destructive"
      class={props.class}
      disabled={props.disabled}
      loading={props.loading}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );

  return (
    <Show when={props.disabled && disabledReason()} fallback={renderButton()}>
      <Tooltip content={disabledReason()} placement="top" delay={0}>
        <span class="flex w-full sm:w-auto">{renderButton()}</span>
      </Tooltip>
    </Show>
  );
}
