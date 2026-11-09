import type { JSX } from 'solid-js';
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
  label: JSX.Element;
  disabled: boolean;
  disabledReason?: string;
  loading?: boolean;
  class?: string;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

export function GitDeleteBranchConfirmButton(props: GitDeleteBranchConfirmButtonProps) {
  const disabledReason = () => trimDeleteBranchReason(props.disabledReason);
  return (
    <Tooltip content={disabledReason()} disabled={!props.disabled || !disabledReason()} placement="top" delay={0} anchorClass="w-full sm:w-auto">
      <span class="flex w-full sm:w-auto">
        <Button
          size="md"
          variant="destructive"
          class={props.class}
          disabled={props.disabled}
          loading={props.loading}
          onClick={props.onClick}
        >
          {props.label}
        </Button>
      </span>
    </Tooltip>
  );
}
