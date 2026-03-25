import { Show, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { Tooltip } from '../primitives/Tooltip';
import { resolveDeleteBranchReview, trimDeleteBranchReason } from './GitDeleteBranchReviewModel';

export function resolveDeleteBranchConfirmDisabledReason(options: {
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  loading?: boolean;
  deleting?: boolean;
  blockingReason?: string;
  confirmBranchName?: string;
}): string {
  return resolveDeleteBranchReview(options).disabledReason;
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
  const disabledReason = () => trimDeleteBranchReason(props.disabledReason);
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
