import type { AskFlowerContextItem, AskFlowerIntent, AskFlowerIntentMode } from '../pages/askFlowerIntent';

function sourceLabel(source: AskFlowerIntent['source']): string {
  if (source === 'file_browser') return 'file browser';
  if (source === 'file_preview') return 'file preview';
  return 'terminal';
}

function sanitizeFenceContent(content: string): string {
  return String(content ?? '').replace(/```/g, '``\u200b`');
}

function buildContextSection(item: AskFlowerContextItem): string {
  if (item.kind === 'file_path') {
    return item.isDirectory
      ? `- Directory path: \`${item.path}\``
      : `- File path: \`${item.path}\``;
  }

  if (item.kind === 'file_selection') {
    const body = sanitizeFenceContent(item.selection);
    return `- Selected text from \`${item.path}\`:\n\n\`\`\`text\n${body}\n\`\`\``;
  }

  const wd = String(item.workingDir ?? '').trim() || '/';
  const selection = String(item.selection ?? '').trim();
  if (!selection) {
    return `- Terminal working directory: \`${wd}\``;
  }

  const body = sanitizeFenceContent(selection);
  return `- Terminal selection (working directory: \`${wd}\`):\n\n\`\`\`text\n${body}\n\`\`\``;
}

function buildAttachmentSection(files: File[]): string {
  if (files.length <= 0) return '';
  const lines = files.map((file) => `- ${file.name} (${Math.max(0, Math.round(file.size / 1024))} KB)`);
  return `Queued attachments:\n${lines.join('\n')}`;
}

export function buildAskFlowerDraftMarkdown(params: {
  intent: AskFlowerIntent;
  includeSuggestedWorkingDir: boolean;
}): string {
  const { intent, includeSuggestedWorkingDir } = params;

  const sections: string[] = [
    `Context from ${sourceLabel(intent.source)}:`,
  ];

  if (intent.contextItems.length > 0) {
    sections.push(intent.contextItems.map((item) => buildContextSection(item)).join('\n\n'));
  }

  const attachmentSection = buildAttachmentSection(intent.pendingAttachments);
  if (attachmentSection) {
    sections.push(attachmentSection);
  }

  if (includeSuggestedWorkingDir) {
    const suggested = String(intent.suggestedWorkingDir ?? '').trim();
    if (suggested) {
      sections.push(`Suggested working directory: \`${suggested}\``);
    }
  }

  const userPrompt = String(intent.userPrompt ?? '').trim();
  if (userPrompt) {
    sections.push(`User request:\n${userPrompt}`);
  }

  return sections
    .map((part) => String(part ?? '').trim())
    .filter((part) => part)
    .join('\n\n');
}

export function mergeAskFlowerDraft(params: {
  currentText: string;
  nextText: string;
  mode: AskFlowerIntentMode;
}): string {
  const currentText = String(params.currentText ?? '').trim();
  const nextText = String(params.nextText ?? '').trim();

  if (!nextText) return currentText;
  if (params.mode === 'replace') return nextText;
  if (!currentText) return nextText;
  return `${currentText}\n\n${nextText}`;
}
