/** Keep H5 persistence separate from PC storage and from other learner attempts. */
export function createMobileStorageKey(
  scope: string,
  ownerId?: string,
  resourceId?: string,
): string {
  const segments = ['ruleexam', 'mobile']
  if (ownerId !== undefined) segments.push(encodeURIComponent(ownerId))
  segments.push(encodeURIComponent(scope))
  if (resourceId !== undefined) segments.push(encodeURIComponent(resourceId))
  return segments.join(':')
}
