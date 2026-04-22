import type { WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';

import type { RedevenWorkbenchWidgetBodyActivation } from './workbenchInputRouting';

export type RedevenWorkbenchWidgetLifecycle = 'hot' | 'warm' | 'cold';

export type RedevenWorkbenchWidgetBodyProps = WorkbenchWidgetBodyProps & {
  activation?: RedevenWorkbenchWidgetBodyActivation;
  lifecycle?: RedevenWorkbenchWidgetLifecycle;
  selected?: boolean;
  filtered?: boolean;
  requestActivate?: () => void;
};

export function resolveRedevenWorkbenchWidgetLifecycle(args: {
  selected: boolean;
  filtered: boolean;
}): RedevenWorkbenchWidgetLifecycle {
  if (args.filtered) {
    return 'cold';
  }
  return args.selected ? 'hot' : 'warm';
}
