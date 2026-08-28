import type { PluginReleaseRef } from '@floegence/redevplugin-ui';

export const EXAMPLE_PLUGIN_RELEASE_REF = {
  source_id: 'example_market',
  channel: 'stable',
  release_metadata_ref: 'plugins/com.example/com.example.metrics/4.4.9/release.json',
  release_metadata_sha256: '7f36244ce5fe5f80751051f1aa2adcb49d049eab2f748d751ae7021cbf074a15',
  publisher_id: 'com.example',
  plugin_id: 'com.example.metrics',
  version: '4.4.9',
  expected_hashes: {
    package_sha256: 'sha256:954894fbc63c3490fe011c9a6baf8985258a3c9c98a16827ed8342aaf438ed32',
    manifest_sha256: 'sha256:ab8c23c53758bba5165fd4d50c7972e94791dd1ccff75de02c51c554767fb12b',
    entries_sha256: 'sha256:8b043db413f20ae08be6252f74bbd82fc17a82592192d40c9947a5fcb9983c0f',
  },
} as const satisfies PluginReleaseRef;
