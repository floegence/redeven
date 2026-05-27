import { createMemo } from 'solid-js';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, SettingsPill } from '../SettingsPrimitives';
import { EnvDebugConsoleSettingsPanel } from '../../EnvDebugConsoleSettingsPanel';

export function DebugConsoleSection() {
  const ctx = useEnvSettingsPage();

  const debugConsoleEnabled = createMemo(() => ctx.env.debugConsoleEnabled());

  return (
    <SettingsCard
      icon={RefreshIcon}
      title="Debug Console"
      description="Frontend-only diagnostics controls for the floating request and UI-performance console."
      actions={<SettingsPill tone="success">Local UI state</SettingsPill>}
    >
      <EnvDebugConsoleSettingsPanel
        enabled={debugConsoleEnabled()}
        canInteract={ctx.canInteract()}
        onEnabledChange={(value) => ctx.env.setDebugConsoleEnabled(value)}
      />
    </SettingsCard>
  );
}
