export function isRichFilePreview(name: string): boolean {
  return /\.(?:csv|tsv|xlsx|docx|pptx)$/i.test(name);
}
