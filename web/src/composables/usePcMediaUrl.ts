import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { invalidatePcMedia, resolvePcMedia } from '../services/media-content';
import { isMediaContextCurrent, mediaContext, onMediaContextChange } from '../services/media-context';

export function usePcMediaUrl(assetId: Ref<string | null | undefined>) {
  const imageUrl = ref('');
  const loading = ref(false);
  const failed = ref(false);
  const revision = ref(0);
  let contextInvalidated = false;
  const unsubscribe = onMediaContextChange(() => { contextInvalidated = true; imageUrl.value = ''; revision.value += 1; });
  let retries = 0;
  watch([assetId, revision], async ([id], previous, onCleanup) => {
    if (previous && previous[0] !== id) contextInvalidated = false;
    const context = mediaContext();
    const controller = new AbortController();
    let current = true;
    onCleanup(() => { current = false; controller.abort(); });
    imageUrl.value = '';
    failed.value = false;
    loading.value = Boolean(id);
    if (!id) return;
    if (contextInvalidated) { loading.value = false; failed.value = true; return; }
    try {
      const ticket = await resolvePcMedia(id, controller.signal);
      if (current && isMediaContextCurrent(context)) imageUrl.value = ticket.content_url;
    } catch { if (current) failed.value = true; }
    finally { if (current) loading.value = false; }
  }, { immediate: true, flush: 'sync' });
  watch(assetId, () => { retries = 0; });
  const retryImage = () => {
    if (!assetId.value || retries++ > 0) { failed.value = true; imageUrl.value = ''; return; }
    invalidatePcMedia(assetId.value);
    contextInvalidated = false;
    revision.value += 1;
  };
  onBeforeUnmount(unsubscribe);
  return { imageUrl, loading, failed, retryImage };
}
