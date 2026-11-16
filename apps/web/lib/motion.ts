import { tokens } from '@orvyn/design-tokens';

/** Springs from the design tokens, shaped for `motion` transitions. */
export const spring = {
  snappy: { type: 'spring' as const, ...tokens.motion.springs.snappy },
  smooth: { type: 'spring' as const, ...tokens.motion.springs.smooth },
  gentle: { type: 'spring' as const, ...tokens.motion.springs.gentle },
};
