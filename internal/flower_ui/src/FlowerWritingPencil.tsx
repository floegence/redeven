import { Icon, type IconNode, type LucideIcon } from 'lucide-solid';

// The tip rests at (12.5, 18.25), exactly at the end of the ink path. Keeping
// the barrel and its two seams separate from the ink lets motion pivot at the tip.
const writingPencilNode: IconNode = [
  ['path', { d: 'M4 18.25 5.9 17.65 7.1 18.25 8.8 17.75 10 18.25h2.5', 'data-flower-writing-part': 'ink' }],
  ['path', { d: 'm12.5 18.25.4-3.35L20 4.1a1.5 1.5 0 0 1 2.5 1.65l-7.1 10.8z', 'data-flower-writing-part': 'pencil' }],
  ['path', { d: 'm18.9 5.8 2.5 1.65m-8.5 7.45 2.5 1.65', 'data-flower-writing-part': 'seams' }],
];

export const FlowerWritingPencil: LucideIcon = (props) => <Icon {...props} name="writing-pencil" iconNode={writingPencilNode} />;
