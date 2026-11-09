import { Select, type SelectProps } from '@floegence/floe-webapp-core/ui';
import { createEffect, createMemo, createSignal, splitProps } from 'solid-js';
import { useSettingsPanelHost } from '../../../../../../settings_ui/src/SettingsPanelHost';
import type { SettingsSection } from '../../../../../../settings_ui/src/settingsSession';

type SettingsSelectProps = Omit<SelectProps, 'open' | 'defaultOpen' | 'onOpenChange'> & {
  section: SettingsSection;
  /** Omit for category resource selectors; pass an exact resource for editors. */
  resource?: string;
  active?: boolean;
};

/** Product presentation admission; published Floe owns every control mechanic. */
export function SettingsSelect(props: SettingsSelectProps) {
  const host = useSettingsPanelHost();
  const [local, control] = splitProps(props, ['section', 'resource', 'active', 'disabled', 'onChange', 'onOptionSelect', 'onQueryChange', 'onRetry']);
  const [open, setOpen] = createSignal(false);
  // IMPORTANT: Retention preserves values, not a popup or mutation authority.
  // Resolve under this owner; Select reads callbacks/props outside rendering.
  const admitted = createMemo(() => local.active !== false && !local.disabled && !control.readOnly && (!host || host.present()
    && host.target()?.section === local.section && (local.resource === undefined || (host.target()?.resource ?? '') === local.resource)));
  const presentedOpen = createMemo(() => admitted() && open());
  createEffect(() => { if (!admitted()) setOpen(false); });
  return <Select {...control} disabled={!admitted()} open={presentedOpen()}
    onOpenChange={value => setOpen(value && admitted())}
    onChange={value => { if (admitted()) local.onChange?.(value); }}
    onOptionSelect={option => { if (admitted()) local.onOptionSelect?.(option); }}
    onQueryChange={query => { if (admitted()) local.onQueryChange?.(query); }}
    onRetry={() => { if (admitted()) local.onRetry?.(); }} />;
}
