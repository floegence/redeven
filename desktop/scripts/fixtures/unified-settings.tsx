import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets, BUILT_IN_SHELL_THEME_DEFAULTS } from '@floegence/floe-webapp-core';
import { Button, SettingsList, SettingRow, SettingsSection } from '@floegence/floe-webapp-core/ui';
import { DesktopSettingsDialog } from '../../src/welcome/DesktopSettingsDialog';
import { DesktopLanguageSettings } from '../../src/welcome/App';
import { DesktopThemePicker, type DesktopThemePickerSnapshot } from '../../src/welcome/DesktopThemePicker';
import { createDesktopI18n, type RedevenLocale, type RedevenLanguageSnapshot } from '../../src/shared/i18n';
import { createSettingsSession } from '../../../internal/settings_ui/src/settingsSession';
import { SettingsPanelContext } from '../../../internal/settings_ui/src/SettingsPanelHost';
import type { FlowerSurfaceAdapter, FlowerSettingsSnapshot } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import '../../src/welcome/index.css';

const params = new URLSearchParams(location.search);
const locale = (params.get('locale') ?? 'en-US') as RedevenLocale;
const mode = params.get('mode') === 'light' ? 'light' : 'dark';
const snapshot: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: { schema_version: 1, current_model_id: 'openai/model-a', providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', models: [{ model_name: 'model-a', display_name: 'Development model', context_window: 128000, max_output_tokens: 16000, input_modalities: ['text', 'image'] }] }] }, provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: true, web_search_api_key_configured: false }] };
const adapter = {
  runtime: { display_name: 'Local Environment' }, canMutate: true, loadSettings: async () => snapshot,
  saveDefaultPermission: async () => snapshot, saveModelProfile: async () => snapshot,
  computerManagement: { loadEnvironment: async () => ({ hostname: 'Development Mac', platform: 'darwin', managed: { state: 'on_demand' }, desktop: { state: 'ready' }, chrome: { installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'google_chrome', name: 'Google Chrome', installed: true, prepared: true, connected: false }], profiles: [{ installation_id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', library_id: 'chrome-library', id: 'work', name: 'Work profile' }] } }) },
  extensions: { canInteract: () => true, canAdmin: () => true,
    listSkills: async () => ({ catalog_version: 1, skills: [{ id: 'review', name: 'code-review', description: 'Review changes.', path: '/workspace/.agents/skills/code-review/SKILL.md', scope: 'user_agents', enabled: true, effective: true }] }),
    listSkillSources: async () => ({ items: [] }), listMCP: async () => ({ servers: [] }),
  },
} as unknown as FlowerSurfaceAdapter;
function Fixture() {
  const theme = useTheme();
  const session = createSettingsSession();
  const [language, setLanguage] = createSignal<RedevenLanguageSnapshot>({ preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] });
  const i18n = () => createDesktopI18n(language().resolved_locale);
  const [appearance, setAppearance] = createSignal<DesktopThemePickerSnapshot>({ source: 'system', resolvedTheme: mode, shellThemes: { ...BUILT_IN_SHELL_THEME_DEFAULTS } });
  let writes = 0;
  Object.assign(window, { unifiedSettingsFixture: { session, writes: () => writes } });
  return <SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
    <Button id="fixture-open" onClick={() => session.open({ section: 'appearance' })}>{i18n().t('settings.unifiedTitle')}</Button>
    <DesktopSettingsDialog session={session} panels={[]} i18n={i18n()} flowerScope="local-incarnation" available createFlowerAdapter={() => adapter} changed={() => undefined}
      appearance={() => <div class="redeven-settings-dialog-stack"><DesktopLanguageSettings snapshot={language()} i18n={i18n()} onPreferenceChange={preference => { writes++; setLanguage({ ...language(), preference, resolved_locale: preference === 'system' ? locale : preference }); }} />
        <SettingsSection title={i18n().t('shell.themePicker.title')}><DesktopThemePicker active={session.present() && session.target()?.section === 'appearance'} snapshot={appearance()} i18n={i18n()}
          onSourceChange={source => { writes++; theme.setTheme(source); return setAppearance({ ...appearance(), source, resolvedTheme: theme.resolvedTheme() }); }}
          onShellThemeChange={(mode, preset) => { writes++; theme.selectShellTheme(mode, preset); return setAppearance({ ...appearance(), shellThemes: { ...appearance().shellThemes, [mode]: preset } }); }} /></SettingsSection></div>}
      connections={() => <SettingsList><SettingRow title="Development Mac" control={<Button variant="outline">Configure</Button>} /></SettingsList>} />
  </SettingsPanelContext.Provider>;
}
render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: mode, shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS } }}><Fixture /></FloeProvider>, document.getElementById('root')!);
