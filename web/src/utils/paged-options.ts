export interface OptionIdentity {
  id: string;
}

interface MergePagedOptionsInput {
  replace: boolean;
  selectedId: string;
}

/**
 * Merge a remote option page by string ID. A selected option survives a new
 * keyword search even when it is not part of the first returned page.
 */
export function mergePagedOptions<T extends OptionIdentity>(
  current: readonly T[],
  incoming: readonly T[],
  input: MergePagedOptionsInput,
): T[] {
  const selected = input.selectedId
    ? current.find((item) => String(item.id) === String(input.selectedId))
    : undefined;
  const candidates = input.replace ? [...incoming] : [...current, ...incoming];
  if (selected && !candidates.some((item) => String(item.id) === String(selected.id))) {
    candidates.unshift(selected);
  }
  const unique = new Map<string, T>();
  for (const item of candidates) unique.set(String(item.id), item);
  return [...unique.values()];
}
