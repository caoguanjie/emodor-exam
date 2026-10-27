import { dashboardListIdentity } from '../utils/admin-dashboard-navigation';

export type TabCacheVersions = Record<string, number>;

export function tabCacheKey(path: string, versions: TabCacheVersions): string {
  const identity = dashboardListIdentity(path);
  return `${identity}:${versions[identity] || 0}`;
}

/** Closing or refreshing one fullPath must not invalidate unrelated tabs. */
export function invalidateTabCache(versions: TabCacheVersions, paths: string[]): void {
  for (const path of new Set(paths.map(dashboardListIdentity))) versions[path] = (versions[path] || 0) + 1;
}
