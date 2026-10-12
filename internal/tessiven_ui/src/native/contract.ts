// Presentation formats describe bundled rendering capabilities, independently
// of the DSL versions supported by the server's storage and migration registry.
export const presentationFormat = 'redeven.io/tessiven-presentation/v1';
export const supportedPresentationFormats = [presentationFormat] as const;
export const presentationCapabilities = ['group_layouts'] as const;
export const legacyAPIVersions = [
  'redeven.io/tessiven/v1',
  'redeven.io/tessiven/v1.0.0',
  'redeven.io/tessiven/v1.1.0',
] as const;
