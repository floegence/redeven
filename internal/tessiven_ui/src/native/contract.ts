// Rendering compatibility is explicit; a server migration registry is not a
// promise that a native renderer understands every registered document.
export const supportedAPIVersions = [
  'redeven.io/tessiven/v1',
  'redeven.io/tessiven/v1.0.0',
] as const;
export type RenderableAPIVersion = typeof supportedAPIVersions[number];
export const canvasKind = 'ServiceCanvas';
