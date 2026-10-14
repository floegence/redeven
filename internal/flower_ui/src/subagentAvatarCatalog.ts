import colors from './assets/subagent-avatar-colors.json';

const fur = 'var(--avatar-fur)';
const paper = 'var(--avatar-paper)';
const accent = 'var(--avatar-accent)';
const ink = 'var(--avatar-ink)';

// Original vector portraits use only trusted, static artwork. Thread identity
// selects artwork and never enters the SVG markup or its color values.
const animals = [
  { name: 'cat', art: `<path d="M15 30 13 14 27 23M49 30 51 14 37 23" fill="${fur}"/><path d="m16 23-1-5 7 7m26-2 1-5-7 7" fill="${accent}"/><rect x="14" y="23" width="36" height="30" rx="15" fill="${fur}"/><path d="m19 36 5 2m21-2-5 2" stroke="${accent}" stroke-width="2"/><ellipse cx="32" cy="45" rx="9" ry="6" fill="${paper}"/>` },
  { name: 'fox', art: `<path d="m13 31 1-17 14 10m23 7-1-17-14 10" fill="${fur}"/><path d="m17 25-1-6 8 7m23-1 1-6-8 7" fill="${ink}"/><path d="M13 29Q32 17 51 29L46 45 32 55 18 45Z" fill="${fur}"/><path d="M16 35 32 43 48 35 44 46 32 53 20 46Z" fill="${paper}"/>` },
  { name: 'rabbit', art: `<ellipse cx="23" cy="20" rx="6" ry="15" fill="${fur}"/><ellipse cx="41" cy="20" rx="6" ry="15" fill="${fur}"/><path d="M23 11v16m18-16v16" stroke="${accent}" stroke-width="3"/><rect x="14" y="25" width="36" height="29" rx="15" fill="${fur}"/><ellipse cx="32" cy="46" rx="9" ry="6" fill="${paper}"/>` },
  { name: 'bear', art: `<circle cx="17" cy="25" r="8" fill="${fur}"/><circle cx="47" cy="25" r="8" fill="${fur}"/><circle cx="17" cy="25" r="4" fill="${accent}"/><circle cx="47" cy="25" r="4" fill="${accent}"/><rect x="13" y="23" width="38" height="31" rx="16" fill="${fur}"/><ellipse cx="32" cy="45" rx="10" ry="7" fill="${paper}"/>` },
  { name: 'panda', art: `<circle cx="17" cy="24" r="8" fill="${ink}"/><circle cx="47" cy="24" r="8" fill="${ink}"/><rect x="13" y="23" width="38" height="31" rx="16" fill="${paper}"/><ellipse cx="24" cy="37" rx="7" ry="8" transform="rotate(20 24 37)" fill="${fur}"/><ellipse cx="40" cy="37" rx="7" ry="8" transform="rotate(-20 40 37)" fill="${fur}"/>` },
  { name: 'koala', art: `<circle cx="14" cy="29" r="10" fill="${fur}"/><circle cx="50" cy="29" r="10" fill="${fur}"/><circle cx="14" cy="29" r="6" fill="${paper}"/><circle cx="50" cy="29" r="6" fill="${paper}"/><rect x="15" y="23" width="34" height="31" rx="15" fill="${fur}"/><ellipse cx="32" cy="41" rx="5" ry="7" fill="${ink}"/>` },
  { name: 'owl', art: `<path d="M14 34V17l13 7h10l13-7v17c0 13-8 21-18 21S14 47 14 34" fill="${fur}"/><path d="M16 37c0-14 16-17 16-4 0-13 16-10 16 4 0 15-16 17-16 9 0 8-16 6-16-9" fill="${paper}"/><path d="m28 44 4 5 4-5" fill="${accent}"/>` },
  { name: 'frog', art: `<circle cx="21" cy="27" r="9" fill="${fur}"/><circle cx="43" cy="27" r="9" fill="${fur}"/><rect x="11" y="28" width="42" height="26" rx="13" fill="${fur}"/><ellipse cx="21" cy="31" rx="6" ry="7" fill="${paper}"/><ellipse cx="43" cy="31" rx="6" ry="7" fill="${paper}"/><path d="M23 45q9 8 18 0" fill="none" stroke="${ink}" stroke-width="2"/>` },
  { name: 'dog', art: `<path d="M20 23Q8 17 8 35q0 13 12 8m24-20q12-6 12 12 0 13-12 8" fill="${accent}"/><rect x="15" y="23" width="34" height="31" rx="14" fill="${fur}"/><path d="M33 24q15-1 14 15-13 5-14-15" fill="${paper}"/><ellipse cx="32" cy="46" rx="10" ry="7" fill="${paper}"/>` },
  { name: 'penguin', art: `<path d="M13 40c0-15 7-21 19-21s19 6 19 21v7q-19 16-38 0Z" fill="${accent}"/><path d="M18 37c0-11 10-13 14-3 4-10 14-8 14 3v9q-14 12-28 0Z" fill="${paper}"/><path d="m27 43 5-3 5 3-5 5Z" fill="${fur}"/>` },
  { name: 'axolotl', art: `<path d="m16 29-9-6m9 12H5m11 6-9 6m41-18 9-6m-9 12h11m-11 6 9 6" stroke="${accent}" stroke-width="4"/><rect x="13" y="23" width="38" height="31" rx="16" fill="${fur}"/><path d="M27 46q5 5 10 0" fill="none" stroke="${ink}" stroke-width="2"/>` },
] as const;

const accessories = [
  { name: 'scarf', art: `<path d="M22 52q10 4 20 0l-1 7H23Z" fill="${accent}"/><path d="m35 55 8 6 3-5-8-4" fill="${accent}"/>` },
  { name: 'glasses', art: `<g fill="none" stroke="${ink}" stroke-width="2"><rect x="17" y="32" width="12" height="11" rx="4"/><rect x="35" y="32" width="12" height="11" rx="4"/><path d="M29 36h6m-21 0h3m30 0h3"/></g>` },
  { name: 'beret', art: `<path d="M17 25c-4-13 28-17 31-7 2 6-19 10-31 7" fill="${accent}"/><path d="m32 14 2-5" stroke="${ink}" stroke-width="2"/><path d="m21 24 23-2" stroke="${ink}" stroke-width="2"/>` },
  { name: 'headphones', art: `<path d="M12 36V29c0-20 40-20 40 0v7" fill="none" stroke="${ink}" stroke-width="3"/><rect x="8" y="31" width="7" height="13" rx="3" fill="${accent}"/><rect x="49" y="31" width="7" height="13" rx="3" fill="${accent}"/>` },
  { name: 'cap', art: `<path d="M18 25v-4c0-13 28-13 28 0v4Z" fill="${accent}"/><path d="M17 25h33q4 0 2 3H27" fill="${ink}"/><path d="M31 13v7" stroke="${paper}" stroke-width="2"/>` },
  { name: 'crown', art: `<path d="m22 24-2-13 8 5 4-9 4 9 8-5-2 13Z" fill="${accent}"/><circle cx="32" cy="19" r="2" fill="${paper}"/>` },
  { name: 'flower', art: `<g fill="${accent}"><circle cx="43" cy="19" r="4"/><circle cx="49" cy="22" r="4"/><circle cx="47" cy="28" r="4"/><circle cx="41" cy="28" r="4"/><circle cx="38" cy="22" r="4"/></g><circle cx="44" cy="23" r="3" fill="${paper}"/>` },
  { name: 'bow', art: `<path d="m31 20-12-6v13l12-4m2-3 12-6v13l-12-4" fill="${accent}"/><circle cx="32" cy="21" r="3" fill="${ink}"/>` },
  { name: 'star', art: `<path d="m44 14 2 5 6 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1Z" fill="${accent}"/><path d="M22 53h20l-10 7Z" fill="${accent}"/>` },
] as const;

export const SUBAGENT_AVATAR_PORTRAITS = animals.flatMap((animal, animalIndex) => (
  accessories.map((accessory, accessoryIndex) => ({
    id: `${animal.name}-${accessory.name}`,
    animalIndex,
    accessoryIndex,
  }))
));

export const SUBAGENT_AVATAR_PALETTES = colors.faces.flatMap((face) => (
  colors.backdrops.map((backdrop, index) => ({
    '--avatar-fur': face,
    '--avatar-background': backdrop,
    '--avatar-accent': colors.accents[index]!,
    '--avatar-paper': colors.paper,
    '--avatar-ink': colors.ink,
  }))
));

function identityHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function subagentAvatarIdentity(threadID: string): Readonly<{ portrait: number; palette: number }> {
  return {
    portrait: identityHash(`portrait:${threadID}`) % SUBAGENT_AVATAR_PORTRAITS.length,
    palette: identityHash(`palette:${threadID}`) % SUBAGENT_AVATAR_PALETTES.length,
  };
}

export function subagentAvatarArtwork(portraitIndex: number): string {
  const portrait = SUBAGENT_AVATAR_PORTRAITS[portraitIndex]!;
  const animal = animals[portrait.animalIndex]!;
  const accessory = accessories[portrait.accessoryIndex]!;
  const wideEyes = animal.name === 'frog';
  const eyes = `<g fill="${ink}"><circle cx="${wideEyes ? 21 : 24}" cy="${wideEyes ? 31 : 37}" r="2"/><circle cx="${wideEyes ? 43 : 40}" cy="${wideEyes ? 31 : 37}" r="2"/></g>`;
  const muzzle = ['owl', 'frog', 'penguin', 'axolotl', 'koala'].includes(animal.name)
    ? '' : `<path d="m29 43 3 3 3-3Z" fill="${ink}"/><path d="M32 46v2m-4 0q4 4 8 0" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
  return `<circle cx="32" cy="32" r="32" fill="var(--avatar-background)"/><path d="M17 64v-4q15-14 30 0v4" fill="${accent}"/><g stroke-linecap="round" stroke-linejoin="round">${animal.art}${eyes}${muzzle}${accessory.art}</g>`;
}
