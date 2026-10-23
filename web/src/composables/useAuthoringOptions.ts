import { computed, shallowRef } from 'vue';
import { getAuthoringOptions, type AuthoringOptions } from '../api/question-authoring';

/** The server catalog is authoritative; a failed load never enables a local fallback. */
export function useAuthoringOptions(loadOptions: () => Promise<AuthoringOptions> = getAuthoringOptions) {
  const catalog = shallowRef<AuthoringOptions['difficulties']>([]);
  const loading = shallowRef(false);
  const error = shallowRef('');
  let serial = 0;
  async function load() {
    const ticket = ++serial; loading.value = true; error.value = '';
    try {
      const result = await loadOptions();
      if (ticket === serial) catalog.value = [...result.difficulties].sort((a, b) => a.sort - b.sort);
    } catch (failure) {
      if (ticket === serial) error.value = failure instanceof Error ? failure.message : '难度目录加载失败，请重试';
    } finally { if (ticket === serial) loading.value = false; }
  }
  const difficulties = computed(() => catalog.value.filter((item) => item.enabled));
  const difficultyOptions = computed(() => difficulties.value.map((item) => ({ value: item.code, label: item.label })));
  function difficultyLabel(code: string) { return catalog.value.find((item) => item.code === code)?.label || ({ easy: '简单', medium: '中级', hard: '困难' } as Record<string, string>)[code] || code; }
  return { catalog, difficulties, difficultyOptions, difficultyLabel, loading, error, load };
}
