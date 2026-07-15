export type FlowerActivityIdentityParts = Readonly<{
  threadID?: string;
  runID?: string;
  turnID?: string;
  itemID: string;
}>;

export type FlowerActivityIdentity = string & Readonly<{
  __flowerActivityIdentity: true;
}>;

function identityPart(value: unknown): string {
  return String(value ?? '').trim();
}

export function flowerActivityIdentity(parts: FlowerActivityIdentityParts): FlowerActivityIdentity {
  const itemID = identityPart(parts.itemID);
  if (!itemID) {
    throw new Error('Flower activity identity requires item_id.');
  }
  return JSON.stringify([
    identityPart(parts.threadID),
    identityPart(parts.runID),
    identityPart(parts.turnID),
    itemID,
  ]) as FlowerActivityIdentity;
}
