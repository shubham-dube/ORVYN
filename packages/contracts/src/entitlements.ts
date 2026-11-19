/** Feature switches per person (ADR-0005). The owner has every key implicitly. */
export const MODULE_KEYS = [
  'today',
  'drop',
  'money',
  'library',
  'vault',
  'assistant',
  'brief',
  'chat',
  'ipo',
  'jobs',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Finer-grained capabilities that can be granted on top of modules. */
export const CAPABILITY_KEYS = ['ai.strong_model', 'admin'] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type EntitlementKey = ModuleKey | CapabilityKey;
export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [...MODULE_KEYS, ...CAPABILITY_KEYS];

export function isEntitlementKey(k: string): k is EntitlementKey {
  return (ENTITLEMENT_KEYS as readonly string[]).includes(k);
}
