export const redevenV1StreamKinds = {
  browser: {
    dom: 'browser/dom_v1',
    input: 'browser/input_v1',
    media: 'browser/media_v1',
    upload: 'browser/upload_v1',
  },
  fs: {
    readFile: 'fs/read_file',
  },
} as const;
