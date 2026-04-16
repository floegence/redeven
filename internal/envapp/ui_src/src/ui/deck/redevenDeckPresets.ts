// Deck preset layouts used by the Env App.

export const REDEVEN_DECK_LAYOUT_IDS = {
  default: 'redeven-layout-default',
  terminal: 'redeven-layout-terminal',
  files: 'redeven-layout-files',
  monitoring: 'redeven-layout-monitoring',
  flower: 'redeven-layout-flower',
  codex: 'redeven-layout-codex',
} as const;

export const redevenDeckPresets = [
  {
    id: REDEVEN_DECK_LAYOUT_IDS.default,
    name: 'Default',
    isPreset: true,
    widgets: [
      { id: 'files', type: 'redeven.files', position: { col: 0, row: 0, colSpan: 8, rowSpan: 24 } },
      { id: 'terminal', type: 'redeven.terminal', position: { col: 8, row: 0, colSpan: 16, rowSpan: 12 } },
      { id: 'monitor', type: 'redeven.monitor', position: { col: 8, row: 12, colSpan: 16, rowSpan: 12 } },
    ],
  },
  {
    id: REDEVEN_DECK_LAYOUT_IDS.terminal,
    name: 'Terminal Focus',
    isPreset: true,
    widgets: [
      { id: 'terminal', type: 'redeven.terminal', position: { col: 0, row: 0, colSpan: 24, rowSpan: 12 } },
      { id: 'files', type: 'redeven.files', position: { col: 0, row: 12, colSpan: 12, rowSpan: 12 } },
      { id: 'monitor', type: 'redeven.monitor', position: { col: 12, row: 12, colSpan: 12, rowSpan: 12 } },
    ],
  },
  {
    id: REDEVEN_DECK_LAYOUT_IDS.files,
    name: 'Files Focus',
    isPreset: true,
    widgets: [
      { id: 'files', type: 'redeven.files', position: { col: 0, row: 0, colSpan: 12, rowSpan: 24 } },
      { id: 'terminal', type: 'redeven.terminal', position: { col: 12, row: 0, colSpan: 12, rowSpan: 12 } },
      { id: 'monitor', type: 'redeven.monitor', position: { col: 12, row: 12, colSpan: 12, rowSpan: 12 } },
    ],
  },
  {
    id: REDEVEN_DECK_LAYOUT_IDS.monitoring,
    name: 'Monitoring',
    isPreset: true,
    widgets: [
      { id: 'monitor', type: 'redeven.monitor', position: { col: 0, row: 0, colSpan: 12, rowSpan: 24 } },
      { id: 'terminal', type: 'redeven.terminal', position: { col: 12, row: 0, colSpan: 12, rowSpan: 12 } },
      { id: 'files', type: 'redeven.files', position: { col: 12, row: 12, colSpan: 12, rowSpan: 12 } },
    ],
  },
  {
    id: REDEVEN_DECK_LAYOUT_IDS.flower,
    name: 'Flower Pairing',
    isPreset: true,
    widgets: [
      { id: 'ai', type: 'redeven.ai', position: { col: 0, row: 0, colSpan: 15, rowSpan: 24 } },
      { id: 'terminal', type: 'redeven.terminal', position: { col: 15, row: 0, colSpan: 9, rowSpan: 12 } },
      { id: 'files', type: 'redeven.files', position: { col: 15, row: 12, colSpan: 9, rowSpan: 12 } },
    ],
  },
  {
    id: REDEVEN_DECK_LAYOUT_IDS.codex,
    name: 'Codex Review',
    isPreset: true,
    widgets: [
      { id: 'codex', type: 'redeven.codex', position: { col: 0, row: 0, colSpan: 14, rowSpan: 24 } },
      { id: 'files', type: 'redeven.files', position: { col: 14, row: 0, colSpan: 10, rowSpan: 14 } },
      { id: 'monitor', type: 'redeven.monitor', position: { col: 14, row: 14, colSpan: 10, rowSpan: 10 } },
    ],
  },
] as const;
