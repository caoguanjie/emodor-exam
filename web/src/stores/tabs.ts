import { defineStore } from 'pinia';
import { confirmUnsavedChanges, confirmUnsavedRoutes } from '../composables/useUnsavedChanges';
import { isRetiredAdminPath } from '../router/access';

export interface BusinessTab {
  path: string;
  title: string;
  closable: boolean;
}

const STORAGE_KEY = 're_admin_tabs';

function restoreTabs(): BusinessTab[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((item): item is BusinessTab => (
      item && typeof item.path === 'string' && typeof item.title === 'string' && typeof item.closable === 'boolean'
    ));
    const active = valid.filter((item) => !isRetiredAdminPath(item.path));
    if (active.length !== valid.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    return active;
  } catch {
    return [];
  }
}

export const useTabsStore = defineStore('tabs', {
  state: () => ({ tabs: restoreTabs() as BusinessTab[] }),
  actions: {
    persist() {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.tabs));
    },
    visit(path: string, title: string) {
      if (!path || path.startsWith('/login') || path === '/change-password' || isRetiredAdminPath(path)) return;
      const existing = this.tabs.find((tab) => tab.path === path);
      if (existing) existing.title = title || existing.title;
      else this.tabs.push({ path, title: title || '未命名页面', closable: true });
      this.persist();
    },
    async close(path: string, fallbackPath = '/my/regulations') {
      if (!await confirmUnsavedChanges(path)) return { closed: false, nextPath: null as string | null };
      const index = this.tabs.findIndex((tab) => tab.path === path);
      if (index < 0) return { closed: false, nextPath: null as string | null };
      this.tabs.splice(index, 1);
      this.persist();
      const next = this.tabs[Math.min(index, this.tabs.length - 1)]?.path || fallbackPath;
      return { closed: true, nextPath: next };
    },
    async closeOthers(path: string) {
      if (!await confirmUnsavedRoutes(this.tabs.filter((tab) => tab.path !== path).map((tab) => tab.path))) return false;
      this.tabs = this.tabs.filter((tab) => tab.path === path);
      this.persist();
      return true;
    },
    async closeAll() {
      if (!await confirmUnsavedRoutes(this.tabs.map((tab) => tab.path))) return false;
      this.tabs = [];
      this.persist();
      return true;
    },
    reset() {
      this.tabs = [];
      sessionStorage.removeItem(STORAGE_KEY);
    },
  },
});
