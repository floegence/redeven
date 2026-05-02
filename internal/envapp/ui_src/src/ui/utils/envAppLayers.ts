export const ENV_APP_FLOATING_LAYER = {
  fileBrowserSurface: 144,
  debugConsole: 145,
  previewWindow: 150,
  floatingWindowModal: 160,
  askFlowerComposer: 160,
  askFlowerContextBrowser: 161,
  askFlowerContextPreview: 162,
} as const;

export const ENV_APP_FLOATING_LAYER_CLASS = {
  debugConsole: 'z-[145]',
  previewWindow: 'z-[150]',
} as const;
