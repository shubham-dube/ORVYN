import { v7 } from 'uuid';

/** Time-ordered UUIDs (v7): good index locality, and clients can generate them offline. */
export const newId = (): string => v7();
