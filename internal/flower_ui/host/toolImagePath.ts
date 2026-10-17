/** Canonical image references are display requests; the Runtime authorizes membership. */
export function toolImagePath(input: Readonly<{ thread_id: string; resource_ref: string }>): string {
  const image = /^image:\/\/([a-f0-9]{64})\/(png|jpeg|webp)$/u.exec(input.resource_ref);
  const locator = /^media:v1:([a-f0-9]{64})$/u.exec(input.resource_ref);
  if ((!image && !locator) || !/^[A-Za-z0-9_-]+$/u.test(input.thread_id)) throw new Error('Invalid tool image reference.');
  if (locator) return `/_redeven_proxy/api/ai/threads/${input.thread_id}/tool-media/locator/${locator[1]}`;
  if (!image) throw new Error('Invalid tool image reference.');
  return `/_redeven_proxy/api/ai/threads/${input.thread_id}/tool-media/${image[1]}/${image[2]}`;
}
