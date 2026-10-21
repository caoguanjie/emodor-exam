import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';

const dirtyByRoute = new Map<string, Ref<boolean>>();

async function confirmDiscard(): Promise<boolean> {
  try {
    await ElMessageBox.confirm('当前页面有未保存内容，确定离开并放弃修改吗？', '未保存提醒', {
      type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑',
    });
    return true;
  } catch {
    return false;
  }
}

/** Tabs and router guards share the same dirty registry and confirmation. */
export async function confirmUnsavedChanges(routeKey: string): Promise<boolean> {
  const dirty = dirtyByRoute.get(routeKey);
  if (!dirty?.value) return true;
  const confirmed = await confirmDiscard();
  if (confirmed) dirty.value = false;
  return confirmed;
}

/** Confirm a bulk tab action once, then mark every affected route clean. */
export async function confirmUnsavedRoutes(routeKeys: string[]): Promise<boolean> {
  const dirtyRoutes = [...new Set(routeKeys)].filter((key) => dirtyByRoute.get(key)?.value);
  if (!dirtyRoutes.length) return true;
  if (!await confirmDiscard()) return false;
  for (const key of dirtyRoutes) {
    const dirty = dirtyByRoute.get(key);
    if (dirty) dirty.value = false;
  }
  return true;
}

export function useUnsavedChanges(dirty: Ref<boolean>) {
  const route = useRoute();
  const routeKey = route.fullPath;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = '';
  };

  onMounted(() => {
    dirtyByRoute.set(routeKey, dirty);
    window.addEventListener('beforeunload', beforeUnload);
  });
  onBeforeUnmount(() => {
    if (dirtyByRoute.get(routeKey) === dirty) dirtyByRoute.delete(routeKey);
    window.removeEventListener('beforeunload', beforeUnload);
  });
  onBeforeRouteLeave(async () => confirmUnsavedChanges(routeKey));
  onBeforeRouteUpdate(async (to) => (
    to.fullPath === routeKey ? true : confirmUnsavedChanges(routeKey)
  ));

  return {
    markClean: () => { dirty.value = false; },
    confirmDiscard: () => confirmUnsavedChanges(routeKey),
  };
}
