import { readUIStorageJSON, removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';

export type WorkbenchAppearanceTone = 'paper' | 'ivory' | 'mist' | 'slate';
export type WorkbenchAppearanceTexture = 'solid' | 'grid' | 'pin_dot';

export type WorkbenchAppearance = Readonly<{
  tone: WorkbenchAppearanceTone;
  texture: WorkbenchAppearanceTexture;
}>;

export const WORKBENCH_APPEARANCE_STORAGE_KEY = 'redeven_envapp_workbench_appearance_v1';

export const WORKBENCH_APPEARANCE_TONES = [
  { id: 'paper', label: 'Paper', description: 'Soft white workspace' },
  { id: 'ivory', label: 'Ivory', description: 'Warm beige workspace' },
  { id: 'mist', label: 'Mist', description: 'Light gray workspace' },
  { id: 'slate', label: 'Slate', description: 'Deep blue-gray workspace' },
] as const satisfies readonly {
  id: WorkbenchAppearanceTone;
  label: string;
  description: string;
}[];

export const WORKBENCH_APPEARANCE_TEXTURES = [
  { id: 'solid', label: 'Solid', description: 'Flat canvas background' },
  { id: 'grid', label: 'Grid', description: 'Guided spatial grid' },
  { id: 'pin_dot', label: 'Pin Dot', description: 'Pinned micro-dot texture' },
] as const satisfies readonly {
  id: WorkbenchAppearanceTexture;
  label: string;
  description: string;
}[];

function isWorkbenchAppearanceTone(value: unknown): value is WorkbenchAppearanceTone {
  return value === 'paper'
    || value === 'ivory'
    || value === 'mist'
    || value === 'slate';
}

function isWorkbenchAppearanceTexture(value: unknown): value is WorkbenchAppearanceTexture {
  return value === 'solid'
    || value === 'grid'
    || value === 'pin_dot';
}

export function normalizeWorkbenchAppearance(value: unknown): WorkbenchAppearance | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<WorkbenchAppearance>;
  if (!isWorkbenchAppearanceTone(candidate.tone) || !isWorkbenchAppearanceTexture(candidate.texture)) {
    return null;
  }

  return {
    tone: candidate.tone,
    texture: candidate.texture,
  };
}

export function resolveDefaultWorkbenchAppearance(theme: 'light' | 'dark'): WorkbenchAppearance {
  if (theme === 'dark') {
    return {
      tone: 'slate',
      texture: 'grid',
    };
  }

  return {
    tone: 'mist',
    texture: 'grid',
  };
}

export function readStoredWorkbenchAppearance(): WorkbenchAppearance | null {
  return normalizeWorkbenchAppearance(readUIStorageJSON(WORKBENCH_APPEARANCE_STORAGE_KEY, null));
}

export function writeStoredWorkbenchAppearance(value: WorkbenchAppearance | null): void {
  if (!value) {
    removeUIStorageItem(WORKBENCH_APPEARANCE_STORAGE_KEY);
    return;
  }

  writeUIStorageJSON(WORKBENCH_APPEARANCE_STORAGE_KEY, value);
}

export function workbenchAppearanceToneMeta(tone: WorkbenchAppearanceTone) {
  return WORKBENCH_APPEARANCE_TONES.find((item) => item.id === tone) ?? WORKBENCH_APPEARANCE_TONES[0];
}

export function workbenchAppearanceTextureMeta(texture: WorkbenchAppearanceTexture) {
  return WORKBENCH_APPEARANCE_TEXTURES.find((item) => item.id === texture) ?? WORKBENCH_APPEARANCE_TEXTURES[0];
}
