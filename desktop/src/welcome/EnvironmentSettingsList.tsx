import { For } from 'solid-js';
import { Button, SettingsList } from '@floegence/floe-webapp-core/ui';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import { EnvironmentPlatformIcon } from './EnvironmentCards';

export function EnvironmentSettingsList(props: {
  environments: readonly DesktopEnvironmentEntry[];
  i18n: DesktopI18n;
  onOpen: (environmentID: string) => void;
}) {
  // IMPORTANT: Inventory navigation is one published settings group. Rows keep
  // exact environment identities; opening never changes connection authority.
  return <SettingsList class="environment-settings-list" data-environment-settings-list role="group" aria-label={props.i18n.t('settings.settingsWindowTitle')}>
    <For each={props.environments}>{environment => <Button variant="ghost" class="environment-settings-list-row"
      aria-label={props.i18n.t('environmentCenter.settingsForLabel', { label: environment.label })}
      onClick={() => props.onOpen(environment.id)}>
      <span class="environment-settings-list-identity">
        <EnvironmentPlatformIcon platform={environment.runtime_platform} linuxDistribution={environment.runtime_linux_distribution} i18n={props.i18n} />
        <span class="environment-settings-list-name">{environment.label}</span>
      </span>
      <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Button>}</For>
  </SettingsList>;
}
