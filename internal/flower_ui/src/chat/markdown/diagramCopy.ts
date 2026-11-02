import type { DiagramLabels } from '@floegence/floe-webapp-core/diagrams';

export const diagramEnUS = {
  "diagram": "Diagram",
  "loading": "Rendering diagram\u2026",
  "unavailable": "Diagram unavailable",
  "retry": "Retry",
  "source": "Source",
  "preview": "Preview",
  "copy": "Copy source",
  "copied": "Copied",
  "copyFailed": "Could not copy",
  "expand": "Expand diagram",
  "close": "Close",
  "zoomIn": "Zoom in",
  "zoomOut": "Zoom out",
  "fit": "Fit"
} satisfies DiagramLabels;

export function localizedDiagramLabels(t: (key: DiagramMessageKey) => string): DiagramLabels {
  return {
    diagram: t('flowerSurface.chat.diagram.diagram'),
    loading: t('flowerSurface.chat.diagram.loading'),
    unavailable: t('flowerSurface.chat.diagram.unavailable'),
    retry: t('flowerSurface.chat.diagram.retry'),
    source: t('flowerSurface.chat.diagram.source'),
    preview: t('flowerSurface.chat.diagram.preview'),
    copy: t('flowerSurface.chat.diagram.copy'),
    copied: t('flowerSurface.chat.diagram.copied'),
    copyFailed: t('flowerSurface.chat.diagram.copyFailed'),
    expand: t('flowerSurface.chat.diagram.expand'),
    close: t('flowerSurface.chat.diagram.close'),
    zoomIn: t('flowerSurface.chat.diagram.zoomIn'),
    zoomOut: t('flowerSurface.chat.diagram.zoomOut'),
    fit: t('flowerSurface.chat.diagram.fit'),
  };
}

type DiagramMessageKey = `flowerSurface.chat.diagram.${keyof DiagramLabels}`;
