import { readFilePreviewWindowRequest } from '../shared/filePreviewWindow';
export interface DesktopWindowSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title?: string;
  attachToParent?: boolean;
}

const DEFAULT_WINDOW_SPEC: DesktopWindowSpec = {
  width: 1440,
  height: 960,
  minWidth: 1024,
  minHeight: 720,
};

export function resolveDesktopWindowSpec(targetURL: string, parented: boolean): DesktopWindowSpec {
  try {
    if (readFilePreviewWindowRequest(new URL(targetURL).search)) return { width: 1100, height: 800, minWidth: 480, minHeight: 360, attachToParent: false };
  } catch { /* Unrecognized URLs keep the ordinary window specification. */ }
  void parented;
  return DEFAULT_WINDOW_SPEC;
}
