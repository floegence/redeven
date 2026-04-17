import type { Component } from 'solid-js';

export type EnvWorkbenchWidgetType = string;

export interface EnvWorkbenchWidgetBodyProps {
  widgetId: string;
  title: string;
  type: EnvWorkbenchWidgetType;
}

export interface EnvWorkbenchWidgetDefinition {
  type: EnvWorkbenchWidgetType;
  label: string;
  icon: Component<{ class?: string }>;
  body: Component<EnvWorkbenchWidgetBodyProps>;
  defaultTitle: string;
  defaultSize: {
    width: number;
    height: number;
  };
  group?: string;
  singleton?: boolean;
}

export interface EnvWorkbenchWidgetItem {
  id: string;
  type: EnvWorkbenchWidgetType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  created_at_unix_ms: number;
}

export interface EnvWorkbenchViewport {
  x: number;
  y: number;
  scale: number;
}

export interface EnvWorkbenchState {
  version: 1;
  widgets: EnvWorkbenchWidgetItem[];
  viewport: EnvWorkbenchViewport;
  locked: boolean;
  filters: Record<EnvWorkbenchWidgetType, boolean>;
  selectedWidgetId: string | null;
}

export interface EnvWorkbenchContextMenuState {
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
  widgetId?: string | null;
}

export const DEFAULT_ENV_WORKBENCH_VIEWPORT: EnvWorkbenchViewport = {
  x: 120,
  y: 84,
  scale: 1,
};
