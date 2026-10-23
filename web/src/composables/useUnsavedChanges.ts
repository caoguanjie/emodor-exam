import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';

export interface UnsavedChangesOptions {
  /** Restore the last persisted baseline. The callback owns resetting dirty. */
  onDiscard?: () => void | Promise<void>;
  /** Some pending writes cannot safely be abandoned until their receipt is known. */
  canDiscard?: () => boolean;
  onBlocked?: () => void;
  /** A moving route key is useful for shell-level sources such as the profile dialog. */
  routeKey?: Ref<string>;
}

interface DirtySource {
  token: symbol;
  dirty: Ref<boolean>;
  onDiscard?: () => void | Promise<void>;
  canDiscard?: () => boolean;
  onBlocked?: () => void;
  approvedThisTurn: boolean;
}

const dirtyByRoute = new Map<string, Map<symbol, DirtySource>>();

async function requestDiscard(): Promise<boolean> {
  try {
    await ElMessageBox.confirm('当前页面有未保存内容，确定离开并放弃修改吗？', '未保存提醒', {
      type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑',
    });
    return true;
  } catch {
    return false;
  }
}

function registerSource(routeKey: string, source: DirtySource): void {
  const sources = dirtyByRoute.get(routeKey) || new Map<symbol, DirtySource>();
  sources.set(source.token, source);
  dirtyByRoute.set(routeKey, sources);
}

function unregisterSource(routeKey: string, source: DirtySource): void {
  const sources = dirtyByRoute.get(routeKey);
  if (!sources) return;
  sources.delete(source.token);
  if (!sources.size) dirtyByRoute.delete(routeKey);
}

function routeSources(routeKeys: string[]): DirtySource[] {
  const result = new Map<symbol, DirtySource>();
  for (const key of new Set(routeKeys)) {
    for (const source of dirtyByRoute.get(key)?.values() || []) result.set(source.token, source);
  }
  return [...result.values()];
}

async function confirmSources(sources: DirtySource[], isCurrent?: () => boolean): Promise<boolean> {
  if (isCurrent && !isCurrent()) return false;
  const blocked = () => {
    const protectedSources = sources.filter((source) => source.dirty.value && source.canDiscard?.() === false);
    for (const source of protectedSources) source.onBlocked?.();
    return protectedSources.length > 0;
  };
  if (blocked()) return false;
  const dirtySources = sources.filter((source) => source.dirty.value && !source.approvedThisTurn);
  if (!dirtySources.length) return true;
  if (!await requestDiscard()) return false;
  // A local async action may now belong to another route or draft. Do not
  // approve it or run its baseline-restoring callback after it has expired.
  if (isCurrent && !isCurrent()) return false;
  if (blocked()) return false;

  for (const source of dirtySources) source.approvedThisTurn = true;
  setTimeout(() => {
    for (const source of dirtySources) source.approvedThisTurn = false;
  }, 0);
  for (const source of dirtySources) await source.onDiscard?.();
  return true;
}

/** Confirm all dirty sources currently registered for one route. */
export async function confirmUnsavedChanges(routeKey: string): Promise<boolean> {
  return confirmSources(routeSources([routeKey]));
}

/** Confirm a bulk tab action once, then discard every affected source. */
export async function confirmUnsavedRoutes(routeKeys: string[]): Promise<boolean> {
  return confirmSources(routeSources(routeKeys));
}

/** Logout destroys every cached tab, so it must cover every mounted dirty source first. */
export async function confirmAllUnsavedChanges(): Promise<boolean> {
  return confirmSources([...dirtyByRoute.values()].flatMap((sources) => [...sources.values()]));
}

export function useUnsavedChanges(dirty: Ref<boolean>, options: UnsavedChangesOptions = {}) {
  const route = useRoute();
  const source: DirtySource = {
    token: Symbol('unsaved-source'),
    dirty,
    onDiscard: options.onDiscard,
    canDiscard: options.canDiscard,
    onBlocked: options.onBlocked,
    approvedThisTurn: false,
  };
  let registeredRouteKey = options.routeKey?.value || route.fullPath;
  let stopRouteKeyWatch: (() => void) | undefined;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = '';
  };

  onMounted(() => {
    registerSource(registeredRouteKey, source);
    if (options.routeKey) {
      stopRouteKeyWatch = watch(options.routeKey, (nextKey) => {
        if (nextKey === registeredRouteKey) return;
        unregisterSource(registeredRouteKey, source);
        registeredRouteKey = nextKey;
        registerSource(registeredRouteKey, source);
      }, { flush: 'sync' });
    }
    window.addEventListener('beforeunload', beforeUnload);
  });
  onBeforeUnmount(() => {
    stopRouteKeyWatch?.();
    unregisterSource(registeredRouteKey, source);
    window.removeEventListener('beforeunload', beforeUnload);
  });
  onBeforeRouteLeave(async () => confirmUnsavedChanges(registeredRouteKey));
  onBeforeRouteUpdate(async (to) => (
    to.fullPath === registeredRouteKey ? true : confirmUnsavedChanges(registeredRouteKey)
  ));

  return {
    markClean: () => { dirty.value = false; },
    /** Local dialog cancellation confirms only this caller, not sibling dirty forms. */
    confirmDiscard: (isCurrent?: () => boolean) => confirmSources([source], isCurrent),
  };
}
