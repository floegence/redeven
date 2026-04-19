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
  void targetURL;
  void parented;
  return DEFAULT_WINDOW_SPEC;
}
