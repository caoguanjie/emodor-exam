import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';
import type { LocationQuery, LocationQueryRaw, RouteLocationNormalizedLoaded, Router } from 'vue-router';

const listPaths = ['/admin/students', '/admin/questions', '/admin/papers', '/admin/training-statistics'] as const;
type DashboardListPath = typeof listPaths[number];
type PaperStatus = 'draft' | 'published' | 'withdrawn' | 'archived';
export type DashboardEntry =
  | { kind: 'students'; source: 'institution' | 'external' | undefined; status: 0 | 1 | undefined }
  | { kind: 'questions'; enabled: boolean | undefined }
  | { kind: 'papers'; status: PaperStatus | undefined; create: boolean }
  | { kind: 'statistics'; paperId: string | undefined };
export interface DashboardEntryResult {
  explicitEntry: boolean;
  intent: DashboardEntry | null;
  invalidKeys: string[];
  cleanQuery: LocationQueryRaw;
}

/** Only these four list views share a cache and tab across route filters. */
export function dashboardListIdentity(fullPath: string): string {
  const path = fullPath.split(/[?#]/, 1)[0];
  return listPaths.includes(path as DashboardListPath) ? path : fullPath;
}

export function parseDashboardEntry(path: string, query: LocationQuery): DashboardEntryResult {
  const result: DashboardEntryResult = { explicitEntry: false, intent: null, invalidKeys: [], cleanQuery: { ...query } };
  if (!listPaths.includes(path as DashboardListPath)) return result;
  function read(key: string, valid: (value: string) => boolean): string | undefined {
    if (!(key in query)) return undefined;
    const value = query[key];
    if (typeof value === 'string' && valid(value)) return value;
    result.invalidKeys.push(key);
    delete result.cleanQuery[key];
    return undefined;
  }
  result.explicitEntry = read('entry', value => value === 'dashboard') === 'dashboard';
  delete result.cleanQuery.entry;
  if (path === '/admin/students') {
    const source = read('source', value => value === 'institution' || value === 'external') as 'institution' | 'external' | undefined;
    const status = read('status', value => value === '0' || value === '1');
    if (result.explicitEntry || 'source' in query || 'status' in query) result.intent = { kind: 'students', source, status: status === undefined ? undefined : status === '1' ? 1 : 0 };
  } else if (path === '/admin/questions') {
    const enabled = read('enabled', value => ['all', 'true', 'false'].includes(value));
    if (result.explicitEntry || 'enabled' in query) result.intent = { kind: 'questions', enabled: enabled === undefined || enabled === 'all' ? undefined : enabled === 'true' };
  } else if (path === '/admin/papers') {
    const status = read('status', value => ['all', 'draft', 'published', 'withdrawn', 'archived'].includes(value));
    const create = read('create', value => value === '1') === '1';
    if (result.explicitEntry || 'status' in query || 'create' in query) result.intent = { kind: 'papers', status: status === 'all' ? undefined : status as PaperStatus | undefined, create };
  } else {
    const paperId = read('paper_id', value => /^[1-9]\d*$/.test(value));
    if (result.explicitEntry || 'paper_id' in query) result.intent = { kind: 'statistics', paperId };
  }
  return result;
}

function queryKey(query: LocationQuery | LocationQueryRaw): string {
  return JSON.stringify(Object.keys(query).sort().map(key => [key, query[key]]));
}

interface ListNavigationOptions {
  path: DashboardListPath;
  routeKey?: Ref<string>;
  beforeEntry?: () => Promise<boolean>;
  apply: (entry: DashboardEntry, explicit: boolean) => void;
  prepare?: () => Promise<void>;
  load: () => Promise<void>;
  openCreate?: () => boolean;
  onInvalid: (keys: string[]) => void;
}

/** Receive the dashboard's small route protocol once per navigation, including cached views. */
export function useDashboardListNavigation(route: RouteLocationNormalizedLoaded, router: Pick<Router, 'replace'>, options: ListNavigationOptions) {
  const routeKey = options.routeKey || ref(route.fullPath);
  let mounted = false;
  let active = true;
  let firstActivation = true;
  let handledKey: string | undefined;
  let pendingKey: string | undefined;
  let generation = 0;
  let prepared = false;
  let preparation: Promise<void> | undefined;
  const currentKey = () => `${route.path}:${queryKey(route.query)}`;

  async function replaceQuery(query: LocationQueryRaw) {
    if (queryKey(query) === queryKey(route.query)) return;
    const previousKey = currentKey();
    const nextKey = `${route.path}:${queryKey(query)}`;
    handledKey = nextKey;
    await router.replace({ path: options.path, query, hash: route.hash });
    if (currentKey() === nextKey) routeKey.value = route.fullPath;
    else if (handledKey === nextKey) handledKey = previousKey;
  }

  async function receive(refresh = false) {
    if (!active || route.path !== options.path) return;
    const key = currentKey();
    if (pendingKey === key || (!refresh && handledKey === key)) return;
    const turn = ++generation;
    pendingKey = key;
    const isCurrent = () => active && turn === generation && route.path === options.path;
    try {
      const parsed = parseDashboardEntry(route.path, route.query);
      if (parsed.explicitEntry && options.beforeEntry && !await options.beforeEntry()) {
        // A cached destination may already own the new URL when its local dialog declines reset.
        // Keep its dirty source attached to that actual tab for later close/refresh protection.
        if (isCurrent()) routeKey.value = route.fullPath;
        return;
      }
      if (!isCurrent()) return;
      if (parsed.intent) options.apply(parsed.intent, parsed.explicitEntry);
      handledKey = key;
      routeKey.value = route.fullPath;
      if (options.prepare && (!prepared || refresh)) {
        preparation ||= options.prepare().then(() => { prepared = true; }).finally(() => { preparation = undefined; });
        await preparation;
      }
      if (!isCurrent()) return;
      if (parsed.invalidKeys.length) options.onInvalid(parsed.invalidKeys);
      if (parsed.intent?.kind === 'papers' && parsed.intent.create && options.openCreate?.()) delete parsed.cleanQuery.create;
      await replaceQuery(parsed.cleanQuery);
      if (isCurrent()) await options.load();
    } finally {
      if (turn === generation) pendingKey = undefined;
    }
  }
  // HTTP errors are already reported by the shared client or the page's loader.
  const initialize = (refresh = false) => { void receive(refresh).catch(() => {}); };
  watch(currentKey, () => { if (mounted) initialize(); });
  onMounted(() => { mounted = true; initialize(); });
  onActivated(() => {
    active = true;
    if (firstActivation) { firstActivation = false; return; }
    initialize(true);
  });
  const deactivate = () => { active = false; generation += 1; pendingKey = undefined; };
  onDeactivated(deactivate);
  onBeforeUnmount(deactivate);

  return {
    routeKey,
    /** Page-owned filter changes update the URL without reinitializing their own list. */
    async syncQuery(patch: LocationQueryRaw) {
      if (route.path !== options.path) return;
      const query: LocationQueryRaw = { ...route.query, ...patch };
      for (const key of Object.keys(query)) if (query[key] === undefined || query[key] === null || query[key] === '') delete query[key];
      await replaceQuery(query);
    },
  };
}
