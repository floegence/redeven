import { Icon, type IconNode, type LucideIcon } from 'lucide-solid';

// Open rings leave room for the arrow, keeping the target legible at badge size.
const goalNode: IconNode = [
  ['path', { d: 'M18.25 11.5a7.5 7.5 0 1 1-5.75-5.75' }],
  ['path', { d: 'M14.25 12.5a3.5 3.5 0 1 1-2.75-2.75' }],
  ['path', { d: 'm10.75 13.25 10-10M16 3.25h4.75V8' }],
];

export const FlowerGoalIcon: LucideIcon = (props) => <Icon {...props} name="flower-goal" iconNode={goalNode} data-flower-goal-icon="" />;
