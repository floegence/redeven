// File preview helpers: extension classification, language resolution, and basic content sniffing.

export type PreviewMode = 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'binary' | 'unsupported';
export type TextPreviewPresentation = 'plain' | 'code';

export interface FilePreviewDescriptor {
  mode: PreviewMode;
  textPresentation?: TextPreviewPresentation;
  language?: string;
  wrapText?: boolean;
}

const PLAIN_TEXT_PREVIEW_EXTENSIONS = [
  '.txt', '.text', '.log', '.md', '.markdown', '.readme',
  '.csv', '.tsv', '.psv',
  '.rst', '.asciidoc', '.adoc',
] as const;

const CODE_PREVIEW_EXTENSIONS = [
  '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.env',
  '.html', '.htm', '.xml', '.xhtml', '.css', '.scss', '.sass', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.pyw', '.pyi', '.java', '.kt', '.scala',
  '.go', '.rs', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.cs', '.vb', '.fs', '.fsx', '.fsi',
  '.php', '.rb', '.pl', '.pm', '.sh', '.bash', '.zsh', '.fish',
  '.swift', '.m', '.mm', '.r', '.sql', '.lua', '.dart',
  '.tex', '.latex',
  '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig',
  '.makefile', '.cmake', '.gradle', '.maven', '.pom',
] as const;

export const TEXT_PREVIEW_EXTENSIONS = [...PLAIN_TEXT_PREVIEW_EXTENSIONS, ...CODE_PREVIEW_EXTENSIONS] as const;

export const IMAGE_PREVIEW_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.ico',
  '.svg', '.tiff', '.tif', '.avif', '.heic', '.heif',
] as const;

export const PDF_PREVIEW_EXTENSIONS = ['.pdf'] as const;
export const DOCX_PREVIEW_EXTENSIONS = ['.docx'] as const;
export const XLSX_PREVIEW_EXTENSIONS = ['.xlsx', '.xls'] as const;

export const FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR: FilePreviewDescriptor = {
  mode: 'text',
  textPresentation: 'plain',
  wrapText: true,
};

const PLAIN_TEXT_EXTENSION_SET = new Set<string>(PLAIN_TEXT_PREVIEW_EXTENSIONS);
const CODE_PREVIEW_EXTENSION_SET = new Set<string>(CODE_PREVIEW_EXTENSIONS);
const IMAGE_PREVIEW_EXTENSION_SET = new Set<string>(IMAGE_PREVIEW_EXTENSIONS);
const PDF_PREVIEW_EXTENSION_SET = new Set<string>(PDF_PREVIEW_EXTENSIONS);
const DOCX_PREVIEW_EXTENSION_SET = new Set<string>(DOCX_PREVIEW_EXTENSIONS);
const XLSX_PREVIEW_EXTENSION_SET = new Set<string>(XLSX_PREVIEW_EXTENSIONS);

const LANGUAGE_BY_EXTENSION: Record<string, string | undefined> = {
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.conf': 'ini',
  '.config': 'ini',
  '.env': 'ini',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.xhtml': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.vb': 'vb',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.fsi': 'fsharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.pl': 'perl',
  '.pm': 'perl',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.fish': 'fish',
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
  '.r': 'r',
  '.sql': 'sql',
  '.lua': 'lua',
  '.dart': 'dart',
  '.tex': 'latex',
  '.latex': 'latex',
  '.dockerfile': 'dockerfile',
  '.editorconfig': 'ini',
  '.gradle': 'groovy',
  '.cmake': 'cmake',
};

const SPECIAL_CODE_FILENAMES: Record<string, string | undefined> = {
  'dockerfile': 'dockerfile',
  'containerfile': 'dockerfile',
  'makefile': 'makefile',
  'gnumakefile': 'makefile',
  'cmakelists.txt': 'cmake',
  'jenkinsfile': 'groovy',
  '.gitignore': undefined,
  '.gitattributes': undefined,
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
};

function basenameLower(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return (parts.at(-1) ?? '').toLowerCase();
}

export function getExtDot(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return '';
  return name.slice(idx).toLowerCase();
}

export function isLikelyTextContent(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;

  const sampleSize = Math.min(1024, bytes.length);
  let textBytes = 0;
  let controlBytes = 0;

  for (let i = 0; i < sampleSize; i += 1) {
    const byte = bytes[i];
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      textBytes += 1;
      continue;
    }
    if (byte >= 128) {
      textBytes += 1;
      continue;
    }
    controlBytes += 1;
  }

  const textRatio = textBytes / sampleSize;
  const controlRatio = controlBytes / sampleSize;
  return textRatio > 0.95 && controlRatio < 0.05;
}

export function describeFilePreview(name: string): FilePreviewDescriptor {
  const basename = basenameLower(name);
  const ext = getExtDot(basename);

  if (PDF_PREVIEW_EXTENSION_SET.has(ext)) return { mode: 'pdf' };
  if (DOCX_PREVIEW_EXTENSION_SET.has(ext)) return { mode: 'docx' };
  if (XLSX_PREVIEW_EXTENSION_SET.has(ext)) return { mode: 'xlsx' };
  if (IMAGE_PREVIEW_EXTENSION_SET.has(ext)) return { mode: 'image' };

  if (Object.prototype.hasOwnProperty.call(SPECIAL_CODE_FILENAMES, basename)) {
    return {
      mode: 'text',
      textPresentation: 'code',
      language: SPECIAL_CODE_FILENAMES[basename],
      wrapText: false,
    };
  }

  if (CODE_PREVIEW_EXTENSION_SET.has(ext)) {
    return {
      mode: 'text',
      textPresentation: 'code',
      language: LANGUAGE_BY_EXTENSION[ext],
      wrapText: false,
    };
  }

  if (PLAIN_TEXT_EXTENSION_SET.has(ext)) {
    return { ...FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR };
  }

  return { mode: 'binary' };
}

export function previewModeByName(name: string): PreviewMode {
  return describeFilePreview(name).mode;
}

export function mimeFromExtDot(ext: string): string | undefined {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    default:
      return undefined;
  }
}
