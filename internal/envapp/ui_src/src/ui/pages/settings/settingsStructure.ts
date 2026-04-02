import type { JSX } from 'solid-js';
import {
  Code,
  Database,
  FileCode,
  Globe,
  Layers,
  RefreshIcon,
  Shield,
  Terminal,
  Zap,
} from '@floegence/floe-webapp-core/icons';

import { CodexNavigationIcon } from '../../icons/CodexIcon';
import { FlowerIcon } from '../../icons/FlowerIcon';
import type { EnvSettingsSection } from '../EnvContext';

export type SettingsGroupID =
  | 'overview'
  | 'runtime_configuration'
  | 'codespaces_tooling'
  | 'security'
  | 'ai_extensions'
  | 'diagnostics';

export type SettingsNavItem = Readonly<{
  id: EnvSettingsSection;
  label: string;
  icon: (props: { class?: string }) => JSX.Element;
}>;

export type SettingsSectionMeta = Readonly<{
  id: EnvSettingsSection;
  navLabel: string;
  icon: (props: { class?: string }) => JSX.Element;
  group: SettingsGroupID;
}>;

export type SettingsGroupMeta = Readonly<{
  id: SettingsGroupID;
  title: string;
  sections: readonly EnvSettingsSection[];
}>;

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = Object.freeze([
  { id: 'config', navLabel: 'Config File', icon: FileCode, group: 'overview' },
  { id: 'connection', navLabel: 'Connection', icon: Globe, group: 'overview' },
  { id: 'agent', navLabel: 'Runtime Status', icon: Zap, group: 'overview' },
  { id: 'runtime', navLabel: 'Shell & Workspace', icon: Terminal, group: 'runtime_configuration' },
  { id: 'logging', navLabel: 'Logging', icon: Database, group: 'runtime_configuration' },
  { id: 'codespaces', navLabel: 'Codespaces & Tooling', icon: Code, group: 'codespaces_tooling' },
  { id: 'permission_policy', navLabel: 'Permission Policy', icon: Shield, group: 'security' },
  { id: 'ai', navLabel: 'Flower', icon: FlowerIcon, group: 'ai_extensions' },
  { id: 'skills', navLabel: 'Skills', icon: Layers, group: 'ai_extensions' },
  { id: 'codex', navLabel: 'Codex', icon: CodexNavigationIcon, group: 'ai_extensions' },
  { id: 'debug_console', navLabel: 'Debug Console', icon: RefreshIcon, group: 'diagnostics' },
]);

export const SETTINGS_SECTION_META: Readonly<Record<EnvSettingsSection, SettingsSectionMeta>> = Object.freeze(
  SETTINGS_SECTIONS.reduce<Record<EnvSettingsSection, SettingsSectionMeta>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<EnvSettingsSection, SettingsSectionMeta>),
);

export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = Object.freeze([
  { id: 'overview', title: 'Overview', sections: ['config', 'connection', 'agent'] },
  { id: 'runtime_configuration', title: 'Runtime Configuration', sections: ['runtime', 'logging'] },
  { id: 'codespaces_tooling', title: 'Codespaces & Tooling', sections: ['codespaces'] },
  { id: 'security', title: 'Security', sections: ['permission_policy'] },
  { id: 'ai_extensions', title: 'AI & Extensions', sections: ['ai', 'skills', 'codex'] },
  { id: 'diagnostics', title: 'Diagnostics', sections: ['debug_console'] },
]);

export const SETTINGS_GROUP_META: Readonly<Record<SettingsGroupID, SettingsGroupMeta>> = Object.freeze(
  SETTINGS_GROUPS.reduce<Record<SettingsGroupID, SettingsGroupMeta>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<SettingsGroupID, SettingsGroupMeta>),
);

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = Object.freeze(
  SETTINGS_SECTIONS.map((item) => ({
    id: item.id,
    label: item.navLabel,
    icon: item.icon,
  })),
);

export function settingsSectionElementID(section: EnvSettingsSection): string {
  return `redeven-settings-${section}`;
}

export function settingsGroupForSection(section: EnvSettingsSection): SettingsGroupMeta {
  const meta = SETTINGS_GROUPS.find((group) => group.sections.includes(section));
  if (!meta) {
    throw new Error(`Unknown settings group for section: ${section}`);
  }
  return meta;
}
